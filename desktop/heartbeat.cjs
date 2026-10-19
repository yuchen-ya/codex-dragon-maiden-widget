// A late health signal is not a visibility command. Only explicit host state
// or a closed supervisor pipe may hide/stop the companion.
function createHeartbeatMonitor({ now=Date.now, lastSeen, onDelayed=()=>{}, onRecovered=()=>{}, delayMs=6000 }) {
  let delayed=false;
  return { check(){const next=now()-lastSeen()>delayMs;if(next!==delayed){delayed=next;(next?onDelayed:onRecovered)();}return delayed;}, isDelayed:()=>delayed };
}
module.exports={createHeartbeatMonitor};
