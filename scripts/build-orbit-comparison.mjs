// Build a local, self-contained comparison UI next to benchmark screenshots.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
const out=path.resolve(process.argv[2]);
const {rows}=JSON.parse(fs.readFileSync(path.join(out,'codecs.json')));
for(const file of ['reference.png',...rows.map(r=>r.file)]){
  const data=await sharp(path.join(out,file)).extract({left:3900,top:1870,width:720,height:483}).removeAlpha().raw().toBuffer();
  for(let i=0;i<data.length;i++)data[i]=Math.round(Math.min(255,Math.pow(data[i]/255,1.5)*Math.pow(.036,1/2.2)*255*3));
  await sharp(data,{raw:{width:720,height:483,channels:3}}).resize(1440,966,{kernel:'nearest'}).png().toFile(path.join(out,'crop-'+file+'.png'));
}
const html=`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Orbital sky — сравнение сжатия</title>
<style>body{margin:28px;background:#101214;color:#d9dcdf;font:15px/1.5 system-ui}h1{font-size:24px;font-weight:550}p{max-width:950px;color:#a5adb3}select,button{background:#22272b;color:inherit;border:1px solid #42494f;border-radius:6px;padding:9px;font:inherit}label{display:inline-flex;align-items:center;gap:8px;margin:0 12px 12px 0}.scroll{overflow:auto}.view{position:relative;max-width:1440px;width:100%;line-height:0}.view img{width:100%;display:block}.view .over{position:absolute;inset:0;clip-path:inset(0 50% 0 0)}.rule{position:absolute;top:0;bottom:0;left:50%;width:1px;background:#ddd}input[type=range]{width:min(800px,95vw)}.legend{display:flex;justify-content:space-between;max-width:1440px;margin:8px 0}table{border-collapse:collapse;margin-top:24px}td,th{text-align:left;padding:8px 18px 8px 0;border-bottom:1px solid #333}a{color:#b4cfec}</style>
<h1>Сжатие Млечного Пути и пороги звёзд</h1>
<p>Одинаковые кадры, камера, экспозиция и зерно. Слева — выбранный вариант; справа — исходник без потерь или полный каталог. Здесь сохранены кадры эксперимента. Для основной сцены выбран AVIF 50.</p>
<label>Сравнение <select id="mode"><option value="texture">Текстуры в сцене</option><option value="crop">Фактура 2×, яркость ×3</option><option value="stars">Каталог звёзд</option></select></label>
<label>Вариант <select id="variant"></select></label><label>Кадр <select id="frame"></select></label>
<label><input type="checkbox" id="boost">Высветлить ×3 для проверки деталей</label><label><input type="checkbox" id="actual">Масштаб 1:1</label>
<div class="legend"><span id="left"></span><span id="right"></span></div><div class="scroll"><div class="view" id="view"><img id="base"><img class="over" id="over"><div class="rule" id="rule"></div></div></div>
<label>Граница <input id="split" type="range" min="0" max="100" value="50"></label>
<p>Яркость ×3 — только инструмент просмотра. В сцене экспозиция остаётся прежней. Число quality не сопоставимо между кодеками. Размеры — десятичные МБ.</p>
<table><thead><tr><th>Текстура 8192 × 4096</th><th>МБ</th><th>От текущего JPEG</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${r.file}</td><td>${(r.bytes/1e6).toFixed(2)}</td><td>${(r.bytes/rows[0].bytes*100).toFixed(0)}%</td></tr>`).join('')}</tbody></table>
<script>const rows=${JSON.stringify(rows)},$=id=>document.getElementById(id);function options(el,items){el.innerHTML=items.map(([v,t])=>'<option value="'+v+'">'+t+'</option>').join('')}function reset(){const stars=$('mode').value==='stars';options($('variant'),stars?['6.75','6.5','6','5.5'].map(x=>[x,'До '+x+' величины']):rows.map(r=>[r.file,r.file+' · '+(r.bytes/1e6).toFixed(2)+' МБ']));options($('frame'),stars?[['610','Ночь / Млечный Путь'],['1244','Ночь / Луна'],['3433','День']]:[['610','Ночь / Млечный Путь'],['3235','День / центр Галактики']]);if(!stars)$('variant').value='avif-q50-444.avif';update()}function update(){const stars=$('mode').value==='stars',t=$('frame').value,v=$('variant').value;const crop=$('mode').value==='crop';$('base').src=stars?'stars-'+t+'-7.png':crop?'crop-reference.png.png':'texture-'+t+'-reference.png.png';$('over').src=stars?'stars-'+t+'-'+v+'.png':crop?'crop-'+v+'.png':'texture-'+t+'-'+v+'.png';$('frame').disabled=crop;$('left').textContent=stars?'Каталог до '+v:v;$('right').textContent=stars?'Полный каталог, 15 598 звёзд':'EXR → RGB8 → PNG, без JPEG';$('view').style.filter=$('boost').checked?'brightness(3)':'none';$('view').style.width=$('actual').checked?'1440px':'100%';$('view').style.minWidth=$('actual').checked?'1440px':''}function split(){const x=$('split').value;$('over').style.clipPath='inset(0 '+(100-x)+'% 0 0)';$('rule').style.left=x+'%'}$('mode').onchange=reset;for(const id of ['variant','frame','boost','actual'])$(id).onchange=update;$('split').oninput=split;reset();</script></html>`;
fs.writeFileSync(path.join(out,'comparison.html'),html);
