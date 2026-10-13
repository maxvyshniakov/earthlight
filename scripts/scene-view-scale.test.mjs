import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {ViewScale,shellCoverage,viewScaleFor} from '../src/scripts/scene-view-scale.ts';

const toward=[1,0,0,0,1,0,0,0,-1],away=[1,0,0,0,1,0,0,0,1];

test('coverage counts the frame whose rays meet the atmosphere',()=>{
 // A centred disc: radius f·tan(asin(R/d)) in frame heights.
 const shell=1+120/6371,f=1.25,aspect=.5,d=8,r=f*Math.tan(Math.asin(shell/d)),exact=Math.PI*r*r/aspect;
 assert.ok(Math.abs(shellCoverage([0,0,d],toward,f,aspect,96,192)-exact)<.005);
 assert.ok(Math.abs(shellCoverage([0,0,d],toward,f,aspect)-exact)<.04,'the default grid is close enough');
 assert.equal(shellCoverage([0,0,d],away,f,aspect),0);
 assert.equal(shellCoverage([0,0,1.01],away,f,aspect),1,'inside the shell every ray integrates air');
 assert.ok(shellCoverage([0,0,2],toward,f,aspect)>shellCoverage([0,0,d],toward,f,aspect));
});

test('a lighter view affords a larger buffer for the same cost, within a limit',()=>{
 assert.equal(viewScaleFor(1,.2),1);
 assert.equal(viewScaleFor(0,.2),2);
 const far=viewScaleFor(.17,.2);assert.ok(far>1.6&&far<1.8);
 // Cost is scale² × (sky + (1 - sky) × coverage): equal at both views.
 const cost=(s,c)=>s*s*(.2+.8*c);assert.ok(Math.abs(cost(far,.17)-cost(1,1))<1e-9);
});

test('the view factor shrinks promptly but grows only once the view is quiet',()=>{
 const view=new ViewScale();
 assert.equal(view.update(1.73,0,false),false,'growth waits for a stable view');
 assert.equal(view.update(1.73,700,true),false,'never mid-gesture');
 assert.equal(view.update(1.73,800,false),true);assert.equal(view.factor,1.75);
 assert.equal(view.update(1.2,900,true),false,'no more than four resizes a second');
 assert.equal(view.update(1.2,1100,true),true,'a heavier view applies even during a gesture');assert.equal(view.factor,1.2);
 assert.equal(view.update(1,1200,true),false);
 assert.equal(view.update(1,1400,true),true);assert.equal(view.factor,1);
 assert.equal(view.update(1.02,5000,false),false,'sub-step changes do not resize');
});
