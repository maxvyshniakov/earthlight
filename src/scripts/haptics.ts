/** A short tap of the device's vibration motor, where the browser offers one.
 * Android browsers have navigator.vibrate. iOS has no vibration API, but
 * toggling a switch control clicks the Taptic Engine (Safari 18), so a hidden
 * switch stands in; that works only inside a user gesture such as a click.
 * Elsewhere it does nothing. */
let iosSwitch:HTMLLabelElement|null=null,busyUntil=0;
// Motors need about 10 ms to be felt, and each call cuts the previous one
// short, so a click never starts until the last one has played and settled.
const SETTLE_MS=25;
export function haptic(ms=12){
  const now=performance.now();
  if(now<busyUntil)return;
  busyUntil=now+ms+SETTLE_MS;
  if(typeof navigator.vibrate==='function'){navigator.vibrate(ms);return;}
  if(!iosSwitch){
    iosSwitch=document.createElement('label');iosSwitch.ariaHidden='true';iosSwitch.style.display='none';
    const input=document.createElement('input');input.type='checkbox';input.setAttribute('switch','');input.tabIndex=-1;
    iosSwitch.append(input);document.body.append(iosSwitch);
  }
  iosSwitch.click();
}
