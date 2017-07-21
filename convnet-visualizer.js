/*
   
  convnet-visualizer.js 
  Copyright (C) 2017  Robin Dinse <robindinse@googlemail.com>

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  This program is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU General Public License for more details.

  You should have received a copy of the GNU General Public License
  along with this program.  If not, see <http://www.gnu.org/licenses/>.
   
*/


// Define constants.
var SIDEBAR_WIDTH = 460;
var BACKGROUND_COLOR = "#CCC";
var LAYER_HEIGHT = 25;
var LAYER_CAPTION_DISTANCE = 17;
var NODE_DISTANCE = 15;
var NODE_RADIUS = 4.0;
var NODE_STROKE_WIDTH = 1.0;
var MAX_NODE_STROKE_WIDTH = 1.5;
var NODE_COLOR = "#EEE";
var NODE_COLOR_RECEPTIVE = "#F35F43";
var NODE_COLOR_PROJECTIVE = "#3FA7D5";
var LINK_STROKE_WIDTH = 1.0;
var MAX_LINK_STROKE_WIDTH = 1.5;
var LINK_COLOR = "#333";
var LINK_COLOR_RECEPTIVE = "#DB2A12";
var LINK_COLOR_PROJECTIVE = "#3062AD";
var ZOOMING_SPEED = 0.03;
var ZOOMING_SPEED_MULTIPLIER = 4.0;
var NAVIGATION_SPEED = 10;
var NAVIGATION_SPEED_MULTIPLIER = 8.0;
var KEYBOARD_ZOOM_STEP = 1.1;
var KEYBOARD_ZOOM_STEP_MULTIPLIER = 1.5;
var MAX_ZOOM = 5.0;
var MIN_ZOOM = 0.3;
var PADDING = 40;
var CAPTION_FONT_SIZE = 9;
var CAPTION_FONT_TYPE = "Arial";
var CAPTION_X_SHIFT = 0;
var CAPTION_Y_SHIFT = NODE_RADIUS + CAPTION_FONT_SIZE - 1;
var HIGHLIGHT_RECEPTIVE = 0;
var HIGHLIGHT_PROJECTIVE = 1;

var CONV1D = 0;
var CONV1D_TRANSPOSED = 1;
var VALID = 0;
var SAME = 1;

var LAYER_PARAMS = {
  'name':          { 'type': 'str', default: 'Layer' },
  'type':          { 'type': 'list', 'values': ['Conv1D'],
                     'default': CONV1D, 'hidden': true }, // 'Conv1D\u1D40'
  'dim':           { 'type': 'int', 'max': 400, 'min': 1, 'default': 0, 'disabled': true },
  'kernel_width':  { 'type': 'int', 'max': 64, 'min': 1, 'default': 3 },
  'dilation_rate': { 'type': 'int', 'max': 64, 'min': 1, 'default': 1 },
  'stride':        { 'type': 'int', 'max': 64, 'min': 1, 'default': 1 },
  'padding_mode':  { 'type': 'list', 'values': ['VALID', 'SAME'], default: VALID },
  'causal':        { 'type': 'bool', 'default': false }
}


// Define globals.
var table = document.getElementById("main_table");
var canvas = document.getElementById("main_canvas");

var ctx = canvas.getContext("2d");

var network = [];

var view_scale = 1.0;
var view_posx = 0.0;
var view_posy = 0.0;

var shift_down = false;

var area_map = [];
var hover_node = null;
var click_node = null;
var highlight_node = null;
var highlight_mode = HIGHLIGHT_PROJECTIVE;
var receptive_map = [];


// Define DOM data binders.
var dom_network_input_dim;
var dom_show_layer_names;
var dom_show_indices;

dom_network_input_dim = new DOMDataBinder(document.getElementById("input_dim"), 32);
dom_show_layer_names = new DOMDataBinder(document.getElementById("show_layer_names"), true);
dom_show_indices = new DOMDataBinder(document.getElementById("show_indices"), false);


/** This class implements a simple binder of the states of DOM objects and
 * JavaScript variables. See https://stackoverflow.com/a/16484266/852592 */
function DOMDataBinder(element, default_value) {
  this.data = default_value;
  this.element = element;
  switch (element.nodeName) {
  case "INPUT":
    switch (element.type.toUpperCase()) {
    case "CHECKBOX": this.value_key = "checked"; break;  
    default: this.value_key = "value"; break;
    }
    break;
  case "SELECT": this.value_key = "selectedIndex"; break;
  case "SPAN": this.value_key = "innerText"; break;
  }
  this.element[this.value_key] = default_value;
  this.element.addEventListener("change", this, false);
}

DOMDataBinder.prototype.handleEvent = function(event) {
  switch (event.type) {
  case "change":
    this.change(this.element[this.value_key]);
    break;
  }
  
  recomputeNetwork();
  redrawCanvas(true); 
};

DOMDataBinder.prototype.change = function(value, recompute=false) {
  this.data = value;
  this.element[this.value_key] = value;
};


// Define event listeners.
window.addEventListener("resize", resizeCanvas, false);

canvas.addEventListener('DOMMouseScroll', mouseWheelHandler, false);
canvas.addEventListener('mousewheel', mouseWheelHandler, false);
canvas.addEventListener('mousemove', mouseMoveHandler, false);
canvas.addEventListener('wheel', mouseWheelHandler, false);

fork_link = document.getElementById("fork-link");
fork_link.addEventListener('DOMMouseScroll', mouseWheelHandler, false);
fork_link.addEventListener('mousewheel', mouseWheelHandler, false);
fork_link.addEventListener('mousemove', mouseMoveHandler, false);
fork_link.addEventListener('wheel', mouseWheelHandler, false);

canvas.addEventListener("mousedown", mouseDownHandler, false);

// TODO Implement touch events.
// https://developer.apple.com/library/content/documentation/AudioVideo/Conceptual/HTML-canvas-guide/AddingMouseandTouchControlstoCanvas/AddingMouseandTouchControlstoCanvas.html


/** The mouse down event handler. */
function mouseDownHandler(event) {
  var x = event.clientX;
  var y = event.clientY;

  prev_click_node = click_node;
  click_node = null;
  for (var i = 0; i < area_map.length; i++) {
    if (x >= area_map[i].min_x && x < area_map[i].max_x &&
        y >= area_map[i].min_y && y < area_map[i].max_y) {
      
      click_node = area_map[i].info;
    }
  }

  highlight_node = click_node;
  highlight_mode = (event.shiftKey) ? HIGHLIGHT_PROJECTIVE : HIGHLIGHT_RECEPTIVE;
  recomputeNetwork();
  redrawCanvas();
}


/** The mouse move event handler. */
function mouseMoveHandler(event) {
  var x = event.clientX;
  var y = event.clientY;

  prev_hover_node = hover_node;
  hover_node = null;
  for (var i = 0; i < area_map.length; i++) {
    if (x >= area_map[i].min_x && x < area_map[i].max_x &&
        y >= area_map[i].min_y && y < area_map[i].max_y) {
      
      hover_node = area_map[i].info;
    }
  }

  if ((prev_hover_node != null && hover_node == null) ||
      (prev_hover_node == null && hover_node != null) ||
      (prev_hover_node != null && hover_node != null &&
       (prev_hover_node.l != hover_node.l ||
        prev_hover_node.n != hover_node.n))) {

    if (click_node == null) {
      if (hover_node != null) {
        highlight_mode = (event.shiftKey) ? HIGHLIGHT_PROJECTIVE : HIGHLIGHT_RECEPTIVE;
        highlight_node = hover_node;
      } else {
        highlight_node = null;
      }
    }

    recomputeNetwork();
    redrawCanvas();
  }
}
  

/** The mouse wheel event handler. */
function mouseWheelHandler(event) {
   
  // https://stackoverflow.com/a/30134826/852592
  function normalizeWheel(/*object*/ event) /*object*/ {
    var sX = 0, sY = 0,       // spinX, spinY
        pX = 0, pY = 0;       // pixelX, pixelY
  
    // Reasonable defaults
    var PIXEL_STEP  = 10;
    var LINE_HEIGHT = 40;
    var PAGE_HEIGHT = 800;

    // Legacy
    if ('detail'      in event) { sY = event.detail; }
    if ('wheelDelta'  in event) { sY = -event.wheelDelta / 120; }
    if ('wheelDeltaY' in event) { sY = -event.wheelDeltaY / 120; }
    if ('wheelDeltaX' in event) { sX = -event.wheelDeltaX / 120; }

    // side scrolling on FF with DOMMouseScroll
    if ( 'axis' in event && event.axis === event.HORIZONTAL_AXIS ) {
      sX = sY;
      sY = 0;
    }

    pX = sX * PIXEL_STEP;
    pY = sY * PIXEL_STEP;

    if ('deltaY' in event) { pY = event.deltaY; }
    if ('deltaX' in event) { pX = event.deltaX; }

    if ((pX || pY) && event.deltaMode) {
      if (event.deltaMode == 1) {          // delta in LINE units
        pX *= LINE_HEIGHT;
        pY *= LINE_HEIGHT;
      } else {                             // delta in PAGE units
        pX *= PAGE_HEIGHT;
        pY *= PAGE_HEIGHT;
      }
    }

    // Fall-back if spin cannot be determined
    if (pX && !sX) { sX = (pX < 1) ? -1 : 1; }
    if (pY && !sY) { sY = (pY < 1) ? -1 : 1; }

    return { spinX  : sX,
             spinY  : sY,
             pixelX : pX,
             pixelY : pY };
  }

  var normalized = -normalizeWheel(event).spinY;
  multiplier = shift_down ? ZOOMING_SPEED_MULTIPLIER : 1.0;
  scale_factor = 1 + normalized * ZOOMING_SPEED * multiplier;
  if (view_scale * scale_factor < MAX_ZOOM && view_scale * scale_factor > MIN_ZOOM) {
    view_scale *= scale_factor;
    var rect = canvas.getBoundingClientRect();
    var x = event.clientX - rect.left;
    var y = event.clientY - rect.top;
    view_posx = (view_posx - x) * scale_factor + x;
    view_posy = (view_posy - y) * scale_factor + y;
    redrawCanvas();
  }
  
  if (event.preventDefault) { event.preventDefault(); } /* Chrome, Safari, Firefox */
  return false;
}


/** The key down event handler. */
document.onkeydown = function(e) {
  multiplier = (e.shiftKey) ? NAVIGATION_SPEED_MULTIPLIER : 1.0;

  switch (e.keyCode) {
  case 37: // left
    view_posx += NAVIGATION_SPEED * multiplier;
    break;
  case 38: // up
    view_posy += NAVIGATION_SPEED * multiplier;
    break;
  case 39: // right
    view_posx -= NAVIGATION_SPEED * multiplier;
    break;
  case 40: // down 
    view_posy -= NAVIGATION_SPEED * multiplier;
    break;
  case 77: // m 
    scale_factor = KEYBOARD_ZOOM_STEP * Math.min(KEYBOARD_ZOOM_STEP_MULTIPLIER, multiplier);
    if (view_scale * scale_factor < MAX_ZOOM) {
      view_scale *= scale_factor;
      var x = (canvas.width - SIDEBAR_WIDTH) / 2.0;
      var y = (canvas.height) / 2.0;
      view_posx = Math.round((view_posx - x) * scale_factor + x);
      view_posy = Math.round((view_posy - y) * scale_factor + y);
      redrawCanvas(); 
    }
    break;
  case 78: // n
    console.log('zoom');
    scale_factor = (1. / KEYBOARD_ZOOM_STEP) / Math.min(KEYBOARD_ZOOM_STEP_MULTIPLIER, multiplier);
    if (view_scale * scale_factor > MIN_ZOOM) {
      view_scale *= scale_factor;
      var x = (canvas.width - SIDEBAR_WIDTH) / 2.0;
      var y = (canvas.height) / 2.0;
      view_posx = Math.round((view_posx - x) * scale_factor + x);
      view_posy = Math.round((view_posy - y) * scale_factor + y);
      redrawCanvas(); 
    }
    break;
  case 82: // r 
    redrawCanvas(true);  // re-center view 
    break;
  case 16: // shift
    shift_down = true;
    if (click_node == null) {
      highlight_mode = HIGHLIGHT_PROJECTIVE;
      recomputeNetwork();
      redrawCanvas();
    }
    break;
  }
  if (e.keyCode >=37 && e.keyCode <= 40) {
    redrawCanvas(); 
    e.preventDefault();
  }
};


/** The key up event handler. */
document.onkeyup = function(e) {
  switch (e.keyCode) {
  case 16: // shift
    shift_down = false;
    if (click_node == null) {
      highlight_mode = HIGHLIGHT_RECEPTIVE;
      recomputeNetwork();
      redrawCanvas();
    }
    break;
  }
};


/** Resizes the context of the canvas such that it uses the full space at full
 * resolution. */
function resizeCanvas(center=false) {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  redrawCanvas(center); 
}


/** Draws a network link. */
function draw_link(x1, y1, x2, y2, c="#333", w=LINK_STROKE_WIDTH) {
  ctx.save();
  x1 = view_scale * x1 + view_posx;
  y1 = view_scale * y1 + view_posy;
  x2 = view_scale * x2 + view_posx;
  y2 = view_scale * y2 + view_posy;
  ctx.lineWidth = Math.min(w, Math.sqrt(view_scale * w));
  ctx.beginPath();
  ctx.strokeStyle = c;
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}


/** Draws a network node. */
function draw_node(x, y, info=null, c="#EEE") {
  ctx.save();
  x = view_scale * x + view_posx;
  y = view_scale * y + view_posy;
  r = view_scale * NODE_RADIUS;
  
  if (x < -r || x >= canvas.width - SIDEBAR_WIDTH + r ||
      y < -r || y >= canvas.height + r ) {
    
    ctx.restore();
    return;
  }

  ctx.beginPath();
  ctx.arc(x, y, view_scale * NODE_RADIUS, 0, Math.PI * 2, false);
  ctx.fillStyle = c;
  ctx.lineWidth = Math.min(MAX_NODE_STROKE_WIDTH, Math.sqrt(view_scale * NODE_STROKE_WIDTH));
  ctx.strokeStyle = "#333";
  ctx.fill();
  ctx.stroke();

  if (info != null) {
    r *= 1.7;
    area_map.push({ 'min_x': x - r, 'max_x': x + r,
                     'min_y': y - r, 'max_y': y + r, 'info': info });
  }

  ctx.restore();
}


/** Draws the caption of a node. */
function draw_node_caption(x, y, caption, align='b', c="#EEE", shadow=true) {
  ctx.save();
  ctx.font = "bold " + CAPTION_FONT_SIZE + "px " + CAPTION_FONT_TYPE;
  ctx.textAlign = "center";
  ctx.textBaseline = 'middle';
  
  switch (align) {
  case 'l':
    x = view_scale * (x - ctx.measureText(caption).width - NODE_DISTANCE) + view_posx;
    y = view_scale * y + view_posy;
    break;
  case 't':
    x = view_scale * (x + CAPTION_X_SHIFT) + view_posx;
    y = view_scale * (y - CAPTION_Y_SHIFT + (1. + Math.max(1, view_scale))) + view_posy;
    break;
  default:
  case 'b':
    x = view_scale * (x + CAPTION_X_SHIFT) + view_posx;
    y = view_scale * (y + CAPTION_Y_SHIFT - (1. + Math.max(1, view_scale))) + view_posy;
    break;
  }

  if (shadow) {
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 3.5;
    ctx.strokeText(caption, x, y); 
  }

  ctx.fillStyle = c;
  ctx.fillText(caption, x, y); 
  ctx.restore();
}


/** Draws the caption of a layer. */
function draw_layer_caption(x, y, caption) {
  ctx.save();
  ctx.font = CAPTION_FONT_SIZE + "px " + CAPTION_FONT_TYPE;
  ctx.textAlign = "left";
  ctx.textBaseline = 'middle';
  x = view_scale * (x - ctx.measureText(caption).width - NODE_DISTANCE) + view_posx;
  y = view_scale * y + view_posy;
  ctx.fillStyle = "#777";
  ctx.fillText(caption, x, y); 
  ctx.restore();
}


/** Main drawing function. */
function redrawCanvas(center=false) {
  ctx.clearRect(0, 0, canvas.width - SIDEBAR_WIDTH, canvas.height);
  area_map = [];

  var y_offset = network.length * LAYER_HEIGHT + PADDING;
  var prev_spreading = NODE_DISTANCE;
  var prev_x_offset = PADDING;
  var prev_pad_left = 0;
  var prev_dim = parseInt(dom_network_input_dim.data);
  var prev_projective_nodes = Array.apply(null, Array(prev_dim)).map(Boolean.prototype.valueOf, false);
  var prev_receptive_nodes = receptive_map[network.length];

  // TODO Center layer depending on spreading.
  // TODO Make dependent on scale factor relative to widest layer.

  if (center) {
    view_scale = (canvas.width - SIDEBAR_WIDTH) / (prev_spreading * prev_dim + 6. * PADDING);
    x = (prev_spreading * prev_dim + prev_x_offset) / 2.;
    y = (LAYER_HEIGHT * network.length) / 2. + PADDING;
    view_posx = Math.round((canvas.width - SIDEBAR_WIDTH) / 2. - view_scale * x);
    view_posy = Math.round(canvas.height / 2. - view_scale * y);
  }
  
  if (network.length == 0) {
    for (var n = 0; n < prev_dim; n++) {
      draw_node(prev_x_offset + n * prev_spreading, y_offset + LAYER_HEIGHT);
    }
    return;
  }

  y_offset = (network.length - 1) * LAYER_HEIGHT + PADDING;
  
  for (var l = network.length - 1; l >= 0; l--) {
    if (highlight_node != null && highlight_mode == HIGHLIGHT_PROJECTIVE &&
        highlight_node.l == (l + 1)) {
      
      prev_projective_nodes[highlight_node.n] = true;
    }

    var dim;
    var x_offset;
    var spreading;
    var projective_nodes;
    var receptive_nodes = (highlight_node != null && highlight_mode == HIGHLIGHT_RECEPTIVE) ?
        receptive_map[l] : null;

    var highlight_drawing_list = [];
    
    switch (network[l].data.type.data) {
    case CONV1D:
      s = parseInt(network[l].data.stride.data);
      p = parseInt(network[l].data.padding_mode.data);
      r = parseInt(network[l].data.dilation_rate.data);
      k = parseInt(network[l].data.kernel_width.data);
      c = network[l].data.causal.data;
      
      // In case of dilated convolution, we insert r zeros between each weight
      // in the kernel. The kernel size thus becomes larger.
      if (r > 1) {
        k = (k - 1) * r + 1;
      }
      
      prev_pad_left = 0;
      if (p == SAME) {
        dim = Math.max(Math.ceil(prev_dim / s), 0);
        prev_pad = Math.max((dim - 1) * s + k - prev_dim, 0);
        prev_pad_left = Math.floor(prev_pad / 2);
        prev_pad_right = prev_pad - prev_pad_left;
      } else if (p == VALID) {
        dim = Math.max(Math.ceil((prev_dim - k + 1) / s), 0);
      }

      projective_nodes = Array.apply(null, Array(dim)).map(Boolean.prototype.valueOf, false);
      
      // Calculate spacing and left padding by centering the first and last
      // above their respective input neurons.
      x_min = prev_x_offset + (s * 0 + 0 - prev_pad_left) * prev_spreading;
      x_max = prev_x_offset + (s * 0 + k - 1 - prev_pad_left) * prev_spreading;
      x_offset = (x_min + x_max) / 2;
      x_min = prev_x_offset + (s * (dim - 1) + 0 - prev_pad_left) * prev_spreading;
      x_max = prev_x_offset + (s * (dim - 1) + k - 1 - prev_pad_left) * prev_spreading;
      x_offset2 = (x_min + x_max) / 2;
      if (dim == 1) {
        spreading = NODE_DISTANCE;
      } else {
        spreading = (x_offset2 - x_offset) / (dim - 1);
      }

      // Now draw the links.
      for (var n = 0; n < network[l].data.dim.data; n++) {
        x1 = x_offset + n * spreading;
        y1 = y_offset;

        var is_projective = false;
        for (var di = 0; di < (c ? Math.floor((k - 1) / 2) + 1 : k); di++) {
          // Skip over nodes when the filter index is not divisible by the
          // dilation rate.
          if (!(di % r == 0)) {
            continue;
          }
          prev_n = s * n + di - prev_pad_left;
          x2 = prev_x_offset + prev_n * prev_spreading;
          y2 = y_offset + LAYER_HEIGHT;
          
          prev_is_projective = prev_n >= 0 && prev_n < prev_dim && prev_projective_nodes[prev_n];
          if (prev_is_projective) {
            is_projective = true;
          }

          var defer_drawing = false;
          if (highlight_node != null) {
            if (highlight_mode == HIGHLIGHT_PROJECTIVE && prev_is_projective) {
              defer_drawing = true;
            } else if (highlight_mode == HIGHLIGHT_RECEPTIVE && receptive_nodes != null &&
                       prev_receptive_nodes != null &&
                       receptive_nodes[n] && prev_receptive_nodes[prev_n]) {
              defer_drawing = true;
            }
          }

          if (defer_drawing) {
            highlight_drawing_list.push(x1);
            highlight_drawing_list.push(y1);
            highlight_drawing_list.push(x2);
            highlight_drawing_list.push(y2);
          } else {
            draw_link(x1, y1, x2, y2);
          }
        }

        if (is_projective) {
          projective_nodes[n] = true;
        }
      }
      break;
    // case CONV1D_TRANSPOSED:
    //   break;
    }

    for (var i = 0; i < highlight_drawing_list.length; i += 4) {
      x1 = highlight_drawing_list[i];
      y1 = highlight_drawing_list[i + 1];
      x2 = highlight_drawing_list[i + 2];
      y2 = highlight_drawing_list[i + 3];

      var link_color;
      switch(highlight_mode) {
      case HIGHLIGHT_RECEPTIVE: link_color = LINK_COLOR_RECEPTIVE; break;
      case HIGHLIGHT_PROJECTIVE: link_color = LINK_COLOR_PROJECTIVE; break;
      }
      
      draw_link(x1, y1, x2, y2, BACKGROUND_COLOR, 3 * LINK_STROKE_WIDTH);
      draw_link(x1, y1, x2, y2, link_color);
    }
    
    if(dom_show_indices.data) {
      draw_node_caption(prev_x_offset, y_offset + LAYER_HEIGHT, 0);
      draw_node_caption(prev_x_offset + (prev_dim - 1) * prev_spreading,
                        y_offset + LAYER_HEIGHT, prev_dim - 1);
    }
    if (hover_node != null && hover_node.l == l + 1) {
      draw_node_caption(prev_x_offset + hover_node.n * prev_spreading,
                        y_offset + LAYER_HEIGHT, hover_node.n, 't');
    }
    
    for (var n = 0; n < prev_dim; n++) {
      var node_color = NODE_COLOR;
      if (highlight_node != null) {
        if (highlight_mode == HIGHLIGHT_PROJECTIVE && prev_projective_nodes[n]) {
          node_color = NODE_COLOR_PROJECTIVE;
        } else if (highlight_mode == HIGHLIGHT_RECEPTIVE && prev_receptive_nodes != null
                   && prev_receptive_nodes[n]) {
          node_color = NODE_COLOR_RECEPTIVE;
        }
      }
      draw_node(prev_x_offset + n * prev_spreading, y_offset + LAYER_HEIGHT,
                { 'l': l + 1, 'n': n }, node_color);
    }

    if(dom_show_layer_names.data) {
      var layer_caption = (l == network.length - 1) ? "Input" : network[l + 1].data.name.data;
      draw_layer_caption(prev_x_offset - (prev_spreading * prev_pad_left) - LAYER_CAPTION_DISTANCE,
                         y_offset + LAYER_HEIGHT, layer_caption);
    }
    
    y_offset -= LAYER_HEIGHT;
    prev_dim = dim;
    prev_x_offset = x_offset;
    prev_spreading = spreading;
    prev_projective_nodes = projective_nodes;
    prev_receptive_nodes = receptive_nodes;
  }

  for (var n = 0; n < prev_dim; n++) {
    var node_color = NODE_COLOR;
    if (highlight_node != null) {
      if (highlight_mode == HIGHLIGHT_PROJECTIVE && prev_projective_nodes[n]) {
        node_color = NODE_COLOR_PROJECTIVE;
      } else if (highlight_mode == HIGHLIGHT_RECEPTIVE && prev_receptive_nodes != null &&
                 prev_receptive_nodes[n]) {
        node_color = NODE_COLOR_RECEPTIVE;
      }
    }
    draw_node(prev_x_offset + n * prev_spreading, y_offset + LAYER_HEIGHT,
              { 'l': 0, 'n': n }, node_color);
  }
  
  if(dom_show_indices.data) {
    draw_node_caption(prev_x_offset, y_offset + LAYER_HEIGHT, 0);
    draw_node_caption(prev_x_offset + (prev_dim - 1) * prev_spreading,
                      y_offset + LAYER_HEIGHT, prev_dim - 1);
  }
  if (hover_node != null && hover_node.l == 0) {
    draw_node_caption(prev_x_offset + hover_node.n * prev_spreading,
                      y_offset + LAYER_HEIGHT, hover_node.n, 't', "#666", false);
  }

  if(dom_show_layer_names.data) {
    draw_layer_caption(prev_x_offset - (prev_spreading * prev_pad_left) / 2. - LAYER_CAPTION_DISTANCE,
                       y_offset + LAYER_HEIGHT, network[0].data.name.data);
  }
}


/** Updates various states after changes have occurred (e.g. the receptive and
 * projective fields). */
function recomputeNetwork() {
  computeLayerDimensions();
  computeReceptiveField();
  // TODO Re-organize this function using drawing lists.
}


/** Computes the layer sizes. */
function computeLayerDimensions() {
  var prev_pad_left = 0;
  var prev_dim = parseInt(dom_network_input_dim.data);

  if (network.length == 0) {
    return;
  }

  for (var l = network.length - 1; l >= 0; l--) {
    var dim;
    
    switch (network[l].data.type.data) {
    case CONV1D:
      s = parseInt(network[l].data.stride.data);
      p = parseInt(network[l].data.padding_mode.data);
      r = parseInt(network[l].data.dilation_rate.data);
      k = parseInt(network[l].data.kernel_width.data);
      c = network[l].data.causal.data;
      
      // In case of dilated convolution, we insert r zeros between each weight
      // in the kernel. The kernel size thus becomes larger.
      if (r > 1) {
        k = (k - 1) * r + 1;
      }
      
      prev_pad_left = 0;
      if (p == SAME) {
        dim = Math.max(Math.ceil(prev_dim / s), 0);
        prev_pad = Math.max((dim - 1) * s + k - prev_dim, 0);
        prev_pad_left = Math.floor(prev_pad / 2);
        prev_pad_right = prev_pad - prev_pad_left;
      } else if (p == VALID) {
        dim = Math.max(Math.ceil((prev_dim - k + 1) / s), 0);
      }

      if (network[l].data.dim.data != dim) {
        network[l].data.dim.change(dim);
      }
    }
    prev_dim = dim;
  }
}


/** Computes the receptive field of the current active node. */
function computeReceptiveField() {
  if (highlight_node == null || highlight_node.l == network.length ||
      highlight_mode != HIGHLIGHT_RECEPTIVE) {

    if (highlight_node != null && highlight_mode == HIGHLIGHT_RECEPTIVE &&
        highlight_node.l == network.length) {
      
      highlight_node = null;
      click_node = null;
    }
    return;
  }

  receptive_map = [];
  for (var l = 0; l < highlight_node.l; l++) {
    receptive_map.push(null);
  }

  var dim = parseInt(network[highlight_node.l].data.dim.data);
  var receptive_nodes = Array.apply(null, Array(dim)).map(Boolean.prototype.valueOf, false);
  receptive_nodes[highlight_node.n] = true;
  receptive_map.push(receptive_nodes);

  for (var l = highlight_node.l; l < network.length; l++) {
    var prev_dim = (l + 1 == network.length) ?
      parseInt(dom_network_input_dim.data) :
      parseInt(network[l + 1].data.dim.data);
    var prev_receptive_nodes = Array.apply(null, Array(prev_dim)).map(Boolean.prototype.valueOf, false);
    receptive_map.push(prev_receptive_nodes);
    
    switch (network[l].data.type.data) {
    case CONV1D:
      s = parseInt(network[l].data.stride.data);
      p = parseInt(network[l].data.padding_mode.data);
      r = parseInt(network[l].data.dilation_rate.data);
      k = parseInt(network[l].data.kernel_width.data);
      c = network[l].data.causal.data;

      if (r > 1) {
        k = (k - 1) * r + 1;
      }
      
      var prev_pad_left = 0;
      if (p == SAME) {
        dim = Math.max(Math.ceil(prev_dim / s), 0);
        prev_pad = Math.max((dim - 1) * s + k - prev_dim, 0);
        prev_pad_left = Math.floor(prev_pad / 2);
        prev_pad_right = prev_pad - prev_pad_left;
      } else if (p == VALID) {
        dim = Math.max(Math.ceil((prev_dim - k + 1) / s), 0);
      }

      for (var n = 0; n < network[l].data.dim.data; n++) {
        is_receptive = receptive_nodes[n];
        for (var di = 0; di < (c ? Math.floor((k - 1) / 2) + 1 : k); di++) {
          if (!(di % r == 0)) {
            continue;
          }
          prev_node = (s * n + di - prev_pad_left);
          if (is_receptive && prev_node >= 0 && prev_node < prev_dim) {
            prev_receptive_nodes[prev_node] = true;
          }
        }
      }
    }

    dim = prev_dim;
    receptive_nodes = prev_receptive_nodes;
  }
}


/** Updates the layer names with reverse numbering. */
function updateNames() {
  for (var l = network.length - 1; l >= 0; l--) {
    network[l].data.name.change("Layer " + (network.length - l));
  }
}


/** Resets the network to a single default layer. */
function reset() {
  for (l = 0; l < network.length; l++) {
    network[l].tr.parentNode.removeChild(network[l].tr);
  }
  network = [];
  parent.location.hash = "";
  add(document.getElementById("initial_add"), true);
}


/** Deletes the layer corresponding to the table row from which this function is
 * called. */
function del(element) {
  var l;
  for (l = 0; l < network.length; l++) {
    if (element.parentNode.parentNode.isSameNode(network[l].tr)) {
      break;
    }
  }
  network[l].tr.parentNode.removeChild(network[l].tr);
  network.splice(l, 1);
  if (click_node != null && click_node.l > l) {
    click_node.l--;
  }
  if (click_node != null && (click_node <= 0 || click_node.l >= network.length)) {
    click_node = null;
    highlight_node = null;
  }
  updateNames();
  recomputeNetwork();
  redrawCanvas(true);  // re-center
}


/** Adds a default layer above the row from which this function is called. */
function add(element, redraw=true) {
  var l;
  for (l = 0; l < network.length; l++) {
    if (element.parentNode.parentNode.isSameNode(network[l].tr)) {
      break;
    }
  }
  
  var tr = table.insertRow(l + 1);
  var data = {};
  for (var key in LAYER_PARAMS) {
    if (LAYER_PARAMS.hasOwnProperty(key)) {
      var td = document.createElement("td");
      var elem;
      switch (LAYER_PARAMS[key].type) {
      case "bool":
        elem = document.createElement("input");
        elem.setAttribute("type", "checkbox");
        data[key] = new DOMDataBinder(elem, LAYER_PARAMS[key].default);
        break;
      case "str":
        elem = document.createElement("span");
        data[key] = new DOMDataBinder(elem, LAYER_PARAMS[key].default);
        break;
      case "int":
        elem = document.createElement("input");
        elem.setAttribute("type", "number");
        elem.setAttribute("max", LAYER_PARAMS[key].max);
        elem.setAttribute("min", LAYER_PARAMS[key].min);
        if (LAYER_PARAMS[key].hasOwnProperty("disabled") &&
           LAYER_PARAMS[key].disabled) {
          elem.setAttribute("disabled", "");
        }
        data[key] = new DOMDataBinder(elem, LAYER_PARAMS[key].default);
        break;
      case "list":
        var elem = document.createElement("select");
        for (var i = 0; i < LAYER_PARAMS[key].values.length; i++) {
          var opt = document.createElement("option");
          opt.innerText = LAYER_PARAMS[key].values[i];
          elem.appendChild(opt);
        }
        if (LAYER_PARAMS[key].hasOwnProperty("disabled") &&
            LAYER_PARAMS[key].disabled) {
          elem.setAttribute("disabled", "");
        }
        data[key] = new DOMDataBinder(elem, LAYER_PARAMS[key].default);
        break;
      }
      td.appendChild(elem);
      if (!LAYER_PARAMS[key].hidden) {
        tr.appendChild(td);
      }
    }
  }
  
  td = document.createElement("td");
  btn = document.createElement("button");
  btn.setAttribute("onclick", "add(this)");
  btn.className = "add";
  btn.innerText = "+";
  td.appendChild(btn);
  btn = document.createElement("button");
  btn.setAttribute("onclick", "del(this)");
  btn.className = "del";
  btn.innerText = "-";
  td.appendChild(btn);
  tr.appendChild(td);
  
  network.splice(l, 0, {'tr': tr, 'data': data });
  if (click_node != null && click_node.l >= l) {
    click_node.l++;
  }
  if (click_node != null && (click_node <= 0 || click_node.l >= network.length)) {
    click_node = null;
    highlight_node = null;
  }
  recomputeNetwork();
  updateNames();
  if (redraw) {
    redrawCanvas(true);  // re-center
  }
}


/** Saves the current network as a hash/fragment in the address bar of the
 * browser. */
function save_url(reload=true) {
  var data = [parseInt(dom_network_input_dim.data)];
  for (var i = 0; i < network.length; i++) {
    var params = [];
    for (var key in LAYER_PARAMS) {
      if (LAYER_PARAMS.hasOwnProperty(key)) {
        switch(LAYER_PARAMS[key].type) {
        case "bool":
          params.push(network[i].data[key].data ? 1 : 0);
          break;
        case "list":
        case "int":
          params.push(parseInt(network[i].data[key].data));
        }
      }
    }
    data.push(params.join(","));
  }
  document.location.hash = data.join("~");
}


/** Renders the current canvas view as an SVG and displays it in a new browser
 * window. */
function save_svg() {
  canvas_ctx = ctx;
  bg = BACKGROUND_COLOR;
  BACKGROUND_COLOR = "#FFF";
  ctx = new C2S(canvas.width - SIDEBAR_WIDTH, canvas_ctx.height);
  redrawCanvas();
  var svg = ctx.getSerializedSvg(true);
  var win = window.open("data:image/svg+xml," + encodeURIComponent(svg), "_blank");
  win.focus();
  ctx = canvas_ctx;
  BACKGROUND_COLOR = bg;
}


// Prepare the network.
if(window.location.hash) {
  // If the fragment is set, restore the network from the given configuration.

  layers = decodeURIComponent(window.location.hash.slice(1)).split("~");
  dom_network_input_dim.change(parseInt(layers[0]));
  for (var i = 1; i < layers.length; i++) {
    add(document.getElementById("input_add"), false);
    var params = layers[i].split(",");
    j = 0;
    for (var key in LAYER_PARAMS) {
      if (LAYER_PARAMS.hasOwnProperty(key)) {
        if (LAYER_PARAMS[key].type == "list" ||
            LAYER_PARAMS[key].type == "bool" ||
            LAYER_PARAMS[key].type == "int") {

          network[network.length - 1].data[key].change(parseInt(params[j]));
          j++;
        }
      }
    }
  }
} else {
  // Otherwise initialize the network with a single default convolutional layer.

  add(document.getElementById("input_add"), false);  // Add a default layer to the list.
}


// We need to manually resize the context such that it fills the entire viewport.
recomputeNetwork();
resizeCanvas(true);
