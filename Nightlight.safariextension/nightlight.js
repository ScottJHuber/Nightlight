var DARKEN_IMAGES  = false;
var IS_AGGRESSIVE  = false;
var OBSERVER       = null;
var WEBPAGE_COLORS = null;

const IGNORED_ELEMENTS = ['VIDEO','SCRIPT'];
const HOTKEY = {
  NONE:            '0',
  OPTION_N:        '1',
  OPTION_O:        '2',
  CONTROL_N:       '3',
  CONTROL_O:       '4',
  SHIFT_COMMAND_F: '5'
};
const HOTKEY_KEYCODE1 = {
  CONTROL:       0,
  OPTION:        1,
  SHIFT_COMMAND: 2
};
const HOTKEY_KEYCODE2 = {
  F: 70,
  N: 78,
  O: 79
};
var USER_HOTKEY_KEYCODE1 = null;
var USER_HOTKEY_KEYCODE2 = null;

const STATE = {
  ACTIVE_NOT_DARKENED:   0,
  ACTIVE_DARKENED:       1,
  INACTIVE_DARKENED:     2,
  INACTIVE_NOT_DARKENED: 3,
  NEEDS_AGGRESSIVE:      4
};
var CURRENT_STATE = STATE.INACTIVE_NOT_DARKENED;

const NIGHTLIGHT_ON  = true;
const NIGHTLIGHT_OFF = false;

function Color(r, g, b, a) {
  this.r = r;
  this.g = g;
  this.b = b;
  this.a = a;
  this.rgbString = function() {
    return (
      this.a == 1 ? 'rgb('+this.r+','+this.g+','+this.b+')' :
                    'rgba('+this.r+','+this.g+','+this.b+','+this.a+')'
    );
  };
  this.hexString = function() {
    return '#' + (
      ((0|(1<<8) + this.r).toString(16)).substr(1) +
      ((0|(1<<8) + this.g).toString(16)).substr(1) +
      ((0|(1<<8) + this.b).toString(16)).substr(1)
    );
  };
  this.isTransparent = function() {
    return this.a === 0;
  };
  /// Returns saturation from HSV color model
  this.saturation = function() {
    var max = Math.max(this.r, Math.max(this.g, this.b));
    var min = Math.min(this.r, Math.min(this.g, this.b));
    return (max - min) / max;
  };
  /// Returns whether the color should be treated as color or as grayscale
  this.isColorful = function() {
    return this.saturation() > 0.15;
  };
  /// Returns approximate ITU-R BT.601 luminance
  this.luminance = function() {
    return ((this.r*3)+this.b+(this.g*4)) >> 3;
  };
  this.isLight = function() {
    return this.luminance() > 100;
  };
  /// Returns a lighter or darker color
  /// percent: positive integer (brighter), negative (darker),
  ///          must be between [-100, 100]
  this.shade = function(percent) {
    var r = this.r + (256 - this.r) * percent/100;
    var g = this.g + (256 - this.g) * percent/100;
    var b = this.b + (256 - this.b) * percent/100;
    r = (r < 0 ? 0 : r);
    g = (g < 0 ? 0 : g);
    b = (b < 0 ? 0 : b);
    r = (r > 255 ? 255 : r);
    g = (g > 255 ? 255 : g);
    b = (b > 255 ? 255 : b);
    return new Color(Math.round(r), Math.round(g), Math.round(b), this.a);
  };
  /// Returns the inverted color
  this.invert = function() {
    return new Color(255-this.r, 255-this.g, 255-this.b, this.a);
  };
}

function ColorFromStr(rgbStr) {
  if (rgbStr === undefined) {
    return;
  }
  var rgb = rgbStr.replace(/rgba?\(/, '').replace(/\)/, '').split(',');
  var r = parseInt(rgb[0]);
  var g = parseInt(rgb[1]);
  var b = parseInt(rgb[2]);
  var a = (rgb[3] === undefined ? 1 : parseFloat(rgb[3]));
  return new Color(r, g, b, a);
}

function ColorFromHex(hexStr) {
  if (hexStr === undefined) {
    return;
  }
  var decimal = parseInt(hexStr, 16);
  var r = (decimal >> 16) & 255;
  var g = (decimal >> 8) & 255;
  var b = (decimal) & 255;
  return new Color(r, g, b, 1);
}

function BlackColor() {
  return new Color(0, 0, 0, 1);
}

function GrayColor() {
  return new Color(128, 128, 128, 1);
}

function TransparentColor() {
  return new Color(0, 0, 0, 0);
}

function makeWebpageColors(element) {
  if (
    element === undefined ||
    IGNORED_ELEMENTS.includes(element.tagName) ||
    [3, 8].includes(element.nodeType)
  ) {
    return;
  }

  var style        = getComputedStyle(element);
  var oldBgColor   = ColorFromStr(style.backgroundColor);
  var oldTextColor = ColorFromStr(style.color);
  var newBgColor, newTextColor;

  if (
    !oldBgColor.isTransparent() &&
    !WEBPAGE_COLORS.bgColors.has(oldBgColor.rgbString())
  ) {
    if (oldBgColor.isColorful()) {
      newBgColor = oldBgColor.shade(-20);
    } else if (oldBgColor.isLight()) {
      newBgColor = oldBgColor.invert();
    } else {
      newBgColor = oldBgColor.shade(-50);
    }
    WEBPAGE_COLORS.bgColors.set(
      oldBgColor.rgbString(), newBgColor.rgbString()
    );
  }

  if (
    !oldTextColor.isTransparent() &&
    !WEBPAGE_COLORS.textColors.has(oldTextColor.rgbString())
  ) {
    if (oldTextColor.isColorful()) {
      if (!oldTextColor.isLight()) {
        newTextColor = oldTextColor.shade(50);
      } else {
        newTextColor = oldTextColor;
      }
    } else {
      if (!oldTextColor.isLight()) {
        newTextColor = oldTextColor.invert();
      } else {
        newTextColor = oldTextColor;
      }
    }
    WEBPAGE_COLORS.textColors.set(
      oldTextColor.rgbString(), newTextColor.rgbString()
    );
  }

  element = element.firstChild;
  while (element) {
    makeWebpageColors(element);
    element = element.nextSibling;
  }
}

function getNewColor(type, oldColor) {
  switch (type) {
  case 'bg':
    return WEBPAGE_COLORS.bgColors.get(oldColor);
  case 'text':
    return WEBPAGE_COLORS.textColors.get(oldColor);
  }
}

function nightlight(mode, element) {
  if (
    element === undefined ||
    [3, 8].includes(element.nodeType) ||
    IGNORED_ELEMENTS.includes(element.tagName)
  ) {
    return;
  }

  if (mode == NIGHTLIGHT_ON) {
    var style        = getComputedStyle(element);
    var oldBgColor   = ColorFromStr(style.backgroundColor);
    var oldTextColor = ColorFromStr(style.color);
    var newBgColor, newTextColor;

    if (oldBgColor.isTransparent()) {
      newBgColor = TransparentColor();
    } else {
      newBgColor = ColorFromStr(getNewColor('bg', oldBgColor.rgbString()));
    }
    if (oldTextColor.isTransparent()) {
      newTextColor = TransparentColor();
    } else {
      newTextColor = ColorFromStr(getNewColor('text', oldTextColor.rgbString()));
    }
    
    if (newBgColor === undefined) {
      newBgColor = BlackColor();
    }
    if (newTextColor === undefined) {
      newTextColor = GrayColor();
    }

    switch (element.tagName) {
    case 'BODY':
      if (newBgColor.isTransparent()) {
        newBgColor = BlackColor();
      }
      element.style.setProperty('background-image', 'none', 'important');
      element.style.setProperty('background-color', newBgColor.rgbString(), 'important');
      element.style.setProperty('color', newTextColor.rgbString(), 'important');
      break;
    case 'CANVAS':
      if (IS_AGGRESSIVE) {
        element.parentNode.removeChild(element);
      }
      break;
    case 'IMG':
      if (DARKEN_IMAGES) {
        element.style.setProperty('filter', 'brightness(70%)', 'important');
      }
      break;
    case 'INPUT':
      if (element.type == 'search') {
        element.style.setProperty('webkit-appearance', 'none', 'important');
      }
      element.style.setProperty('background-color', newBgColor.rgbString(), 'important');
      element.style.setProperty('color', newTextColor.rgbString(), 'important');
      break;
    case 'DIV':
    case 'SPAN':
      if (IS_AGGRESSIVE) {
        element.style.setProperty('border-width', '0px', 'important');
      } else if (style.backgroundImage != 'none') {
        return;
      }
      element.style.setProperty('background-color', newBgColor.rgbString(), 'important');
      element.style.setProperty('border-color', newTextColor.rgbString(), 'important');
      if (!newBgColor.isLight()) {
        element.style.setProperty('color', newTextColor.rgbString(), 'important');
      }
      break;
    default:
      if (IS_AGGRESSIVE) {
        element.style.setProperty('background-image', 'none', 'important');
      }
      element.style.setProperty('background-color', newBgColor.rgbString(), 'important');
      element.style.setProperty('color', newTextColor.rgbString(), 'important');
      break;
    }

  } else if (mode == NIGHTLIGHT_OFF) {
    switch (element.tagName) {
      case 'IMG':
        element.style.filter = null;
        break;
      default:
        element.style.backgroundColor = null;
        element.style.borderColor = null;
        element.style.color = null;
    }
  }

  element = element.firstChild;
  while (element) {
    nightlight(mode, element);
    element = element.nextSibling;
  }
}

function update(isOn) {
  switch (CURRENT_STATE) {
  case STATE.ACTIVE_NOT_DARKENED:
    if (WEBPAGE_COLORS === null) {
      WEBPAGE_COLORS = {
        bgColors:   new Map(),
        textColors: new Map()
      };
      makeWebpageColors(document.body);
    }
    nightlight(NIGHTLIGHT_ON, document.body);
    CURRENT_STATE = STATE.ACTIVE_DARKENED;
    break;
  case STATE.ACTIVE_DARKENED:
    if (!isOn) {
      CURRENT_STATE = STATE.INACTIVE_DARKENED;
      update(isOn);
    }
    break;
  case STATE.INACTIVE_DARKENED:
    nightlight(NIGHTLIGHT_OFF, document.body);
    CURRENT_STATE = STATE.INACTIVE_NOT_DARKENED;
    break;
  case STATE.INACTIVE_NOT_DARKENED:
    if (isOn) {
      CURRENT_STATE = STATE.ACTIVE_NOT_DARKENED;
      update(isOn);
    }
    break;
  case STATE.NEEDS_AGGRESSIVE:
    nightlight(NIGHTLIGHT_ON, document.body);
    CURRENT_STATE = STATE.ACTIVE_DARKENED;
    break;
  }
  safari.self.tab.dispatchMessage('webpageColors', WEBPAGE_COLORS);
}

function updateObserver(isObserving) {
  if (OBSERVER === null) {
    OBSERVER = new MutationObserver(handleMutations);
  }
  if (isObserving) {
    OBSERVER.observe(document.body, { childList: true, subtree: true });
  } else {
    OBSERVER.disconnect();
  }
}

function updateHotkey(hotkey) {
  switch (hotkey) {
  case HOTKEY.NONE:
    USER_HOTKEY_KEYCODE1 = null;
    USER_HOTKEY_KEYCODE2 = null;
    break;
  case HOTKEY.OPTION_N:
    USER_HOTKEY_KEYCODE1 = HOTKEY_KEYCODE1.OPTION;
    USER_HOTKEY_KEYCODE2 = HOTKEY_KEYCODE2.N;
    break;
  case HOTKEY.OPTION_O:
    USER_HOTKEY_KEYCODE1 = HOTKEY_KEYCODE1.OPTION;
    USER_HOTKEY_KEYCODE2 = HOTKEY_KEYCODE2.O;
    break;
  case HOTKEY.CONTROL_N:
    USER_HOTKEY_KEYCODE1 = HOTKEY_KEYCODE1.CONTROL;
    USER_HOTKEY_KEYCODE2 = HOTKEY_KEYCODE2.N;
    break;
  case HOTKEY.CONTROL_O:
    USER_HOTKEY_KEYCODE1 = HOTKEY_KEYCODE1.CONTROL;
    USER_HOTKEY_KEYCODE2 = HOTKEY_KEYCODE2.O;
    break;
  case HOTKEY.SHIFT_COMMAND_F:
    USER_HOTKEY_KEYCODE1 = HOTKEY_KEYCODE1.SHIFT_COMMAND;
    USER_HOTKEY_KEYCODE2 = HOTKEY_KEYCODE2.F;
    break;
  }
}

function handleMessage(event) {
  switch (event.name) {
  case 'state':
    if (event.message.darkenImages !== undefined) {
      DARKEN_IMAGES = event.message.darkenImages;
    }
    if (event.message.isAggressive !== undefined) {
      IS_AGGRESSIVE = event.message.isAggressive;
    }
    if (event.message.isObserving !== undefined) {
      updateObserver(event.message.isObserving);
    }
    if (event.message.hotkey !== undefined) {
      updateHotkey(event.message.hotkey);
    }
    if (event.message.isOn !== undefined) {
      update(event.message.isOn);
    }
    break;
  case 'beAggressive':
    IS_AGGRESSIVE = true;
    CURRENT_STATE = STATE.NEEDS_AGGRESSIVE;
    update(true);
    break;
  }
}

function handleMutations(mutations) {
  mutations.forEach(function(mutation) {
    mutation.addedNodes.forEach(function(addedNode) {
      if (CURRENT_STATE == (STATE.ACTIVE_DARKENED || STATE.ACTIVE_NOT_DARKENED)) {
        nightlight(NIGHTLIGHT_ON, addedNode);
      }
    });
  });
}

function handleReload(event) {
  safari.self.tab.dispatchMessage('pageReload');
}

function handleKeydown(event) {
  var userHotkey1Pressed = false;
  if (USER_HOTKEY_KEYCODE1 == HOTKEY_KEYCODE1.OPTION) {
    userHotkey1Pressed = event.altKey;
  } else if (USER_HOTKEY_KEYCODE1 == HOTKEY_KEYCODE1.CONTROL) {
    userHotkey1Pressed = event.ctrlKey;
  } else if (USER_HOTKEY_KEYCODE1 == HOTKEY_KEYCODE1.SHIFT_COMMAND) {
    userHotkey1Pressed = event.shiftKey && event.metaKey;
  }
  if (userHotkey1Pressed && event.keyCode == USER_HOTKEY_KEYCODE2) {
    event.preventDefault();
    safari.self.tab.dispatchMessage('requestToggleNightlight');
  }
}

if (typeof(safari) == 'object') {
  safari.self.addEventListener('message', handleMessage, false);
}
window.onbeforeunload = handleReload;
window.addEventListener('keydown', handleKeydown, false);