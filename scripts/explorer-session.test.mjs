import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {ExplorerSession} from '../src/scripts/explorer-session.ts';
import {readExplorerSettings,writeLookSettings,writeViewSettings,writePlaybackSettings,writeTimeSliderSetting,writeLensSetting,resetExplorerSettingsURL} from '../src/scripts/explorer-url.ts';
import {timeScaleAt,timeScaleFraction,DEFAULT_TIME_SLIDER_POSITION} from '../src/scripts/scene-control-model.ts';
import {PROJECTION} from '../src/scripts/flight-navigation.ts';
import {exposureMaxEV} from '../src/scripts/camera-exposure.ts';

const params=query=>new URLSearchParams(query);
const session=query=>new ExplorerSession(params(query),true,100);
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} ≈ ${b}`);

test('fresh settings preserve photographic defaults and legacy autoplay',()=>{
  for(const query of ['', 'still=1', 'motion=1', 'rate=NaN&lens=Infinity']){
    const value=session(query);
    assert.equal(value.paused,false);assert.equal(value.timeScale,10);assert.equal(value.timeSliderPosition,600);
    assert.deepEqual(value.settings.view,{yaw:0,pitch:0});assert.equal(value.navigation.focal,PROJECTION);
    assert.deepEqual(value.look,{exposure:0,ghosts:1,grain:1.1,chromatic:.625,galaxy:.2625,manualExposure:null,lensPreset:'iss'});
  }
});
test('stopped links remember default time scale and pause never discards a chosen time scale',()=>{
  const value=session('rate=0');assert.equal(value.paused,true);assert.equal(value.timeScale,10);
  value.toggle();assert.equal(value.shownTimeScale,10);
  value.setTimeScale(100,1000);assert.equal(value.shownTimeScale,100);
  value.setTimeSliderPosition(0,2000);assert.equal(value.shownTimeScale,0);assert.equal(value.timeScale,100);
  value.toggle();assert.equal(value.shownTimeScale,100);
  value.toggle();value.setTimeSliderPosition(DEFAULT_TIME_SLIDER_POSITION,3000);assert.equal(value.paused,false);assert.equal(value.timeScale,10);
});
test('settings and HUD commands share the exact logarithmic scale and clock continuity',()=>{
  const value=session('');value.playback.setRunning(true,0);
  for(const [at,timeScale] of [[1000,1],[2000,.1],[3000,1000]]){
    const before=value.playback.read(at);value.setTimeScale(timeScale,at);
    close(value.playback.read(at),before);assert.equal(value.timeScale,timeScale);
    assert.equal(timeScaleAt(value.timeSliderPosition/1000),timeScale);
  }
  for(const timeScale of [0,.01,.1,1,10,100,1000])close(timeScaleAt(timeScaleFraction(timeScale)),timeScale);
});
test('URL camera precision is independent of the rounded settings presentation',()=>{
  const value=session('yaw=12.34567&pitch=-7.891234&lens=1.234567');
  assert.deepEqual(value.settings.view,{yaw:12.34567,pitch:-7.891234});
  close(value.navigation.focal,PROJECTION*1.234567);
  const saved=params('');writeViewSettings(saved,value.settings.view);
  assert.equal(saved.get('yaw'),'12.34567');assert.equal(saved.get('pitch'),'-7.891234');
  value.setView('yaw',4.56789);assert.equal(value.settings.view.yaw,4.56789);
});
test('range settings clamp and sanitize as the original controls do',()=>{
  const value=readExplorerSettings(params('rate=2000&look-exposure=100&look-grain=-1&look-galaxy=1.23&exposure-fixed=Infinity&yaw=300&pitch=NaN&lens=0'));
  assert.equal(value.timeSliderPosition,1000);assert.equal(value.look.exposure,4);assert.equal(value.look.grain,0);
  assert.equal(value.look.galaxy,1.25);assert.equal(value.fixedExposure,0);
  assert.deepEqual(value.view,{yaw:180,pitch:0});assert.equal(value.lens,.5);
});
test('manual exposure hides compensation without losing it and night limits clamp on handover',()=>{
  const value=session('night=video&exposure-mode=manual&exposure-fixed=99&look-exposure=2.3&lens-preset=flare');
  assert.equal(value.look.exposure,0);assert.equal(value.settings.look.exposure,2.3);
  assert.equal(value.look.manualExposure,exposureMaxEV('video'));
  value.setNight('current');assert.equal(value.look.manualExposure,exposureMaxEV('current'));
  value.settings.exposureMode='auto';assert.equal(value.look.exposure,2.3);assert.equal(value.look.manualExposure,null);
});
test('look, view, playback and live lens round-trip without disturbing renderer parameters',()=>{
  const value=session('look-ghosts=1.4&look-chromatic=.65&look-grain=.45&look-galaxy=1.8&look-exposure=-1.2&exposure-mode=manual&exposure-fixed=2.4&lens-preset=flare&rate=800&motion=0&yaw=4.25');
  value.navigation.focal=PROJECTION*3.75;
  const saved=params('quality=fixed&cloudStudy=modis&custom=retained');
  writeLookSettings(saved,value.settings);writeViewSettings(saved,value.settings.view);writePlaybackSettings(saved,value.paused);
  writeTimeSliderSetting(saved,value.timeSliderPosition);writeLensSetting(saved,value.navigation.focal/PROJECTION);
  const restored=new ExplorerSession(saved,true,100);
  assert.deepEqual(restored.look,value.look);assert.deepEqual(restored.settings.view,value.settings.view);
  assert.equal(restored.paused,true);assert.equal(restored.navigation.focal,value.navigation.focal);
  assert.equal(saved.get('quality'),'fixed');assert.equal(saved.get('custom'),'retained');
});
test('legacy route and Earth-relative orientation migrate through the navigation owner',()=>{
  const value=session('route=polar&flight=free&position=0,0,1.2&heading=1,0,0&elevation=.2&roll=.3&yaw=12&pitch=8');
  assert.equal(value.navigation.orbit,'polar');assert.equal(value.navigation.mode,'free');
  const saved=params('');value.navigation.write(saved);writeViewSettings(saved,value.settings.view,true);
  assert.equal(saved.has('route'),false);assert.equal(saved.has('heading'),false);assert.equal(saved.has('yaw'),false);
  assert.ok(saved.has('orientation'));
  const restored=new ExplorerSession(saved,true,100);
  for(let i=0;i<9;i++)close(restored.navigation.free.basis[i],value.navigation.free.basis[i]);
});
test('calendar commands preserve scene position and serialize epoch exactly',()=>{
  const value=session('epoch=2024-01-01T00:00:00.000Z&t=100');
  value.setCalendar('date',59,100);value.setCalendar('time',123,100);
  assert.equal(value.calendar.date(100).toISOString(),'2024-02-29T02:03:00.000Z');
  assert.equal(value.playback.read(0),100);
  const saved=params('t=100');value.calendar.write(saved);
  const restored=new ExplorerSession(saved,true,100);
  assert.equal(restored.calendar.date(100).toISOString(),value.calendar.date(100).toISOString());
});
test('reset preserves night/study policy and stable state references, clearing user URL settings',()=>{
  const query='night=video&cloudStudy=modis&clouds=off&aurora=on&look-exposure=2&look-grain=.4&rate=0&exposure-mode=manual&exposure-fixed=9&lens-preset=flare&flight=free&orientation=1,0,0,0&position=0,0,2&route=high&t=45&moon=1&quality=fixed';
  const value=session(query),view=value.settings.view,look=value.settings.look;
  value.reset(params(query),1000,25,500,Date.UTC(2026,9,18));
  assert.equal(value.navigation.mode,'follow');assert.equal(value.navigation.orbit,'iss');assert.equal(value.navigation.focal,PROJECTION);
  assert.equal(value.playback.read(1000),475);assert.equal(value.calendar.date(500).toISOString(),'2026-10-18T00:00:00.000Z');
  assert.equal(value.settings.view,view);assert.equal(value.settings.look,look);
  assert.equal(value.settings.night,'video');assert.equal(value.settings.clouds,'original');assert.equal(value.settings.aurora,'auto');
  assert.equal(value.timeScale,10);assert.equal(value.paused,false);assert.equal(value.look.exposure,0);assert.equal(value.look.manualExposure,null);
  const saved=params(query);resetExplorerSettingsURL(saved);writeLookSettings(saved,value.settings);
  assert.equal(saved.toString(),'night=video&cloudStudy=modis&quality=fixed');
});
test('embedded explorer does not restore standalone navigation or lens',()=>{
  const value=new ExplorerSession(params('route=high&flight=free&position=0,0,2&orientation=1,0,0,0&lens=4'),false,100);
  assert.equal(value.navigation.orbit,'iss');assert.equal(value.navigation.mode,'follow');assert.equal(value.navigation.focal,PROJECTION);
});
