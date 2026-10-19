function acceptsWindowMessage(window, event, quitting=false) {
  if(quitting || !window || window.isDestroyed())return false;
  try {const contents=window.webContents;return !!contents&&!contents.isDestroyed()&&event.sender===contents;}catch{return false;}
}
module.exports={acceptsWindowMessage};
