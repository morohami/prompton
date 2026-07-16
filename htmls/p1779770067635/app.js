// ============ TIMEZONE ENGINE ============
const ZONES=[
  {id:'JST',label:'JST +9',offset:540},
  {id:'NPT',label:'NPT +5:45',offset:345},
  {id:'IST',label:'IST +5:30',offset:330},
  {id:'UTC',label:'UTC',offset:0},
  {id:'EST',label:'EST -5',offset:-300},
  {id:'CST',label:'CST -6',offset:-360},
  {id:'PST',label:'PST -8',offset:-480},
  {id:'CET',label:'CET +1',offset:60},
  {id:'SGT',label:'SGT +8',offset:480},
  {id:'KST',label:'KST +9',offset:540},
  {id:'AEST',label:'AEST +10',offset:600},
  {id:'GST',label:'GST +4',offset:240},
  {id:'GMT',label:'GMT',offset:0},
];

function convertTime(hhmm,fromId,toId){
  const f=ZONES.find(z=>z.id===fromId),t=ZONES.find(z=>z.id===toId);
  if(!f||!t||!hhmm)return'';
  const[h,m]=hhmm.split(':').map(Number);
  let tot=h*60+m-f.offset+t.offset;
  while(tot<0)tot+=1440;while(tot>=1440)tot-=1440;
  return pad(Math.floor(tot/60))+':'+pad(tot%60);
}
function pad(n){return String(n).padStart(2,'0')}
function dayJP(d){return['日','月','火','水','木','金','土'][new Date(d+'T00:00:00').getDay()]}
function dayEN(d){return['SUN','MON','TUE','WED','THU','FRI','SAT'][new Date(d+'T00:00:00').getDay()]}
const MONTHS_EN=['','JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

// ============ TIME PICKER (1-min) ============
const HOURS=[...Array(24)].map((_,i)=>pad(i));
const MINUTES=[...Array(60)].map((_,i)=>pad(i));

function buildTimePicker(idBase,defH,defM){
  const wrap=document.createElement('div');
  wrap.className='time-pick';
  const hSel=document.createElement('select');hSel.id=idBase+'_h';
  HOURS.forEach(h=>{const o=document.createElement('option');o.value=h;o.textContent=h;if(h===defH)o.selected=true;hSel.appendChild(o)});
  const sep=document.createElement('span');sep.className='sep';sep.textContent=':';
  const mSel=document.createElement('select');mSel.id=idBase+'_m';
  MINUTES.forEach(m=>{const o=document.createElement('option');o.value=m;o.textContent=m;if(m===defM)o.selected=true;mSel.appendChild(o)});
  wrap.append(hSel,sep,mSel);
  return wrap;
}

// ============ STATE ============
let slots=[
  {date:'2026-05-28',startH:'12',startM:'00',endH:'16',endM:'00',open:false},
  {date:'2026-05-29',startH:'11',startM:'00',endH:'19',endM:'00',open:false},
  {date:'2026-06-01',startH:'12',startM:'00',endH:'16',endM:'00',open:false},
  {date:'2026-06-01',startH:'18',startM:'00',endH:'',endM:'',open:true},
];
let votes=[];
let currentVote=[];
let editingIdx=-1;
let finalizedIdx=-1;

function slotStart(s){return s.startH+':'+s.startM}
function slotEnd(s){return s.open?'':(s.endH+':'+s.endM)}
function slotTimeStr(s){return s.open?slotStart(s)+' ~':slotStart(s)+' - '+slotEnd(s)}
function slotDateStr(s){const d=s.date.split('-');return parseInt(d[1])+'/'+parseInt(d[2])+' ('+dayJP(s.date)+')'}
function slotDateStrEN(s){const d=s.date.split('-');return dayEN(s.date)+' '+MONTHS_EN[parseInt(d[1])]+' '+parseInt(d[2])}

// ============ THEME SWITCHER ============
const THEMES=[
  {id:'gameboy',color:'#0f380f',label:'GAME BOY'},
  {id:'mario',color:'#e60012',label:'MARIO'},
  {id:'zelda',color:'#886c3a',label:'ZELDA'},
  {id:'pokemon',color:'#e85040',label:'POKEMON'},
  {id:'space',color:'#ff00aa',label:'SPACE'},
  {id:'tetris',color:'#ffdc00',label:'TETRIS'},
];
let currentTheme='gameboy';
function renderThemeSwitch(){
  const el=document.getElementById('themeSwitch');
  THEMES.forEach(t=>{
    const d=document.createElement('span');
    d.className='theme-dot'+(t.id===currentTheme?' active':'');
    d.style.background=t.color;
    d.title=t.label;
    d.onclick=()=>{
      currentTheme=t.id;
      document.body.className='theme-'+t.id;
      el.querySelectorAll('.theme-dot').forEach(x=>x.classList.remove('active'));
      d.classList.add('active');
    };
    el.appendChild(d);
  });
}

// ============ CONVERTER ============
function initConverter(){
  const fS=document.getElementById('convFrom'),tS=document.getElementById('convTo');
  fS.innerHTML=ZONES.map(z=>`<option value="${z.id}"${z.id==='JST'?' selected':''}>${z.label}</option>`).join('');
  tS.innerHTML=ZONES.map(z=>`<option value="${z.id}"${z.id==='NPT'?' selected':''}>${z.label}</option>`).join('');
  const calc=()=>{
    const r=convertTime(document.getElementById('convTime').value,fS.value,tS.value);
    document.getElementById('convOut').textContent=r?r+' '+tS.value:'--:--';
  };
  fS.onchange=tS.onchange=document.getElementById('convTime').oninput=calc;
  calc();
}

// ============ SLOT SETUP ============
function renderSlots(){
  const list=document.getElementById('slotList');
  list.innerHTML='';
  slots.forEach((s,i)=>{
    const card=document.createElement('div');
    card.className='slot-card';

    const dateIn=document.createElement('input');
    dateIn.type='date';dateIn.value=s.date;
    dateIn.onchange=()=>{slots[i].date=dateIn.value};

    const startPick=buildTimePicker('s'+i+'s',s.startH,s.startM);
    startPick.querySelectorAll('select').forEach(sel=>{
      sel.onchange=()=>{
        slots[i].startH=document.getElementById('s'+i+'s_h').value;
        slots[i].startM=document.getElementById('s'+i+'s_m').value;
      };
    });

    const dash=document.createElement('span');
    dash.className='slot-dash';
    dash.textContent=s.open?'~':'>';

    let endPick;
    if(!s.open){
      endPick=buildTimePicker('s'+i+'e',s.endH||'17',s.endM||'00');
      endPick.querySelectorAll('select').forEach(sel=>{
        sel.onchange=()=>{
          slots[i].endH=document.getElementById('s'+i+'e_h').value;
          slots[i].endM=document.getElementById('s'+i+'e_m').value;
        };
      });
    }

    const toggleBtn=document.createElement('button');
    toggleBtn.className='slot-open-toggle';
    toggleBtn.textContent=s.open?'SET END':'OPEN END';
    toggleBtn.onclick=()=>{
      slots[i].open=!slots[i].open;
      if(!slots[i].open&&!slots[i].endH){slots[i].endH='17';slots[i].endM='00'}
      renderSlots();
    };

    const rmBtn=document.createElement('button');
    rmBtn.className='btn-rm';rmBtn.textContent='DEL';
    rmBtn.title='Remove this slot';
    rmBtn.onclick=()=>{slots.splice(i,1);renderSlots()};

    card.append(dateIn,startPick,dash);
    if(endPick)card.append(endPick);
    card.append(toggleBtn,rmBtn);
    list.appendChild(card);
  });
}

function addSlot(){
  const last=slots[slots.length-1];
  const d=last?last.date:new Date().toISOString().split('T')[0];
  slots.push({date:d,startH:'10',startM:'00',endH:'17',endM:'00',open:false});
  renderSlots();
}

// ============ EVENT HEADER ============
function renderEventHeader(){
  const title=document.getElementById('eventTitle').value.trim();
  const msg=document.getElementById('orgMessage').value.trim();
  const html=(title?`<div class="event-title-display">${esc(title)}</div>`:'')+
    (title?`<div class="event-divider"></div>`:'')+
    (msg?`<div class="event-msg">${esc(msg)}</div>`:'<div class="event-msg" style="color:var(--txt3)">...no quest info...</div>');
  document.getElementById('eventHeaderDisplay').innerHTML=html;
  document.getElementById('eventHeaderDisplay2').innerHTML=html;
}

// ============ VOTE FORM ============
function renderVoteForm(){
  const list=document.getElementById('voteSlotList');
  list.innerHTML='';
  slots.forEach((s,i)=>{
    const row=document.createElement('div');
    row.className='vote-slot-row';
    row.innerHTML=`
      <div class="vote-slot-info">
        <div class="vote-slot-date">${slotDateStr(s)}</div>
        <div class="vote-slot-time">${slotTimeStr(s)}</div>
      </div>
      <div class="vote-btns">
        <button class="vb${currentVote[i]==='ok'?' sel':''}" data-v="ok" data-i="${i}" onclick="setVote(${i},'ok',this)">○</button>
        <button class="vb${currentVote[i]==='maybe'?' sel':''}" data-v="maybe" data-i="${i}" onclick="setVote(${i},'maybe',this)">△</button>
        <button class="vb${currentVote[i]==='ng'?' sel':''}" data-v="ng" data-i="${i}" onclick="setVote(${i},'ng',this)">×</button>
      </div>`;
    list.appendChild(row);
  });
}

function setVote(i,val,btn){
  currentVote[i]=val;
  document.querySelectorAll(`.vb[data-i="${i}"]`).forEach(b=>b.classList.remove('sel'));
  btn.classList.add('sel');
}

function submitVote(){
  const name=document.getElementById('voterName').value.trim();
  const comment=document.getElementById('voterComment').value.trim();
  if(!name){alert('! ENTER YOUR NAME !');return}
  if(currentVote.some(v=>!v)){alert('! ANSWER ALL SLOTS !');return}
  if(editingIdx>=0){
    votes[editingIdx]={name,choices:[...currentVote],comment};
  }else{
    votes.push({name,choices:[...currentVote],comment});
  }
  resetVoteForm();
  renderRespList();
}

function editVote(i){
  editingIdx=i;
  const v=votes[i];
  document.getElementById('voterName').value=v.name;
  document.getElementById('voterComment').value=v.comment||'';
  currentVote=[...v.choices];
  document.getElementById('voteFormTitle').textContent='EDIT: '+v.name.toUpperCase();
  document.getElementById('voteFormCancel').style.display='inline-block';
  document.getElementById('submitBtn').textContent='SAVE';
  renderVoteForm();
  document.getElementById('voteForm').scrollIntoView({behavior:'smooth',block:'start'});
}

function cancelEdit(){
  editingIdx=-1;
  resetVoteForm();
}

function resetVoteForm(){
  editingIdx=-1;
  currentVote=slots.map(()=>'');
  document.getElementById('voterName').value='';
  document.getElementById('voterComment').value='';
  document.getElementById('voteFormTitle').textContent='NEW PLAYER';
  document.getElementById('voteFormCancel').style.display='none';
  document.getElementById('submitBtn').textContent='SUBMIT';
  renderVoteForm();
}

// ============ RESPONSES ============
function renderRespList(){
  const el=document.getElementById('respList');
  document.getElementById('respCount').textContent=votes.length+' '+(votes.length===1?'PLAYER':'PLAYERS');
  if(votes.length===0){
    el.innerHTML='<div class="empty-state">No players yet. Be the hero.</div>';
    return;
  }
  el.innerHTML='';
  const wrap=document.createElement('div');
  wrap.className='resp-list';
  votes.forEach((v,vi)=>{
    const row=document.createElement('div');
    row.className='resp-row';
    row.onclick=()=>editVote(vi);
    let answers='';
    v.choices.forEach((c,ci)=>{
      const sym=c==='ok'?'○':c==='maybe'?'△':'×';
      answers+=`<span class="resp-ans ${c}"><span class="mark">${sym}</span>${slotDateStr(slots[ci])} ${slotStart(slots[ci])}</span>`;
    });
    row.innerHTML=`
      <div class="resp-row-head">
        <span class="resp-name">${esc(v.name)}</span>
        <span class="resp-edit-hint">EDIT &gt;</span>
      </div>
      <div class="resp-answers">${answers}</div>
      ${v.comment?`<div class="resp-comment">${esc(v.comment)}</div>`:''}`;
    wrap.appendChild(row);
  });
  el.appendChild(wrap);
}

// ============ FINALIZE ============
function renderFinalizeList(){
  const el=document.getElementById('finalizeList');
  if(votes.length===0){
    el.innerHTML='<div class="empty-state">No players responded yet</div>';
    return;
  }
  let html='';
  slots.forEach((s,i)=>{
    let ok=0,maybe=0,okNames=[],maybeNames=[];
    votes.forEach(v=>{
      if(v.choices[i]==='ok'){ok++;okNames.push(v.name)}
      else if(v.choices[i]==='maybe'){maybe++;maybeNames.push(v.name)}
    });
    const allNames=[...okNames,...maybeNames.map(n=>n+'(?)')];
    const sel=finalizedIdx===i?'selected':'';
    html+=`<div class="fin-row ${sel}" onclick="finalize(${i})">
      <div class="fin-radio"></div>
      <div class="fin-info">
        <div class="fin-date">${slotDateStr(s)}</div>
        <div class="fin-time">${slotTimeStr(s)}</div>
      </div>
      <div class="fin-tally">
        <div class="fin-tally-counts"><span class="ok">○${ok}</span><span class="maybe">△${maybe}</span></div>
        ${allNames.length?`<div class="fin-tally-names">${esc(allNames.join(', '))}</div>`:''}
      </div>
    </div>`;
  });
  el.innerHTML=html;
}

function finalize(i){
  finalizedIdx=i;
  renderFinalizeList();
  renderShareMessage();
}

function renderShareMessage(){
  const box=document.getElementById('shareBox');
  const emptyEl=document.getElementById('shareEmpty');
  if(finalizedIdx<0){box.classList.remove('show');emptyEl.style.display='block';return}
  emptyEl.style.display='none';
  box.classList.add('show');

  const s=slots[finalizedIdx];
  const title=document.getElementById('eventTitle').value.trim()||'Meeting';
  const orgMsg=document.getElementById('orgMessage').value.trim();

  let attendees=[];
  votes.forEach(v=>{
    const c=v.choices[finalizedIdx];
    if(c==='ok')attendees.push(v.name);
    else if(c==='maybe')attendees.push(v.name+' (tentative)');
  });

  const convFrom=document.getElementById('convFrom').value;
  const convTo=document.getElementById('convTo').value;
  const targetTZ=(convTo==='JST')?convFrom:convTo;

  let msg='';
  msg+=`Subject: [Confirmed] ${title}\n\n`;
  msg+=`Dear all,\n\n`;
  msg+=`Thank you for responding. The date for our meeting has been confirmed as follows:\n\n`;
  msg+=`  ${slotDateStrEN(s)}\n`;
  msg+=`  ${slotTimeStr(s)} JST (Japan Time)\n`;
  if(targetTZ!=='JST'){
    const cStart=convertTime(slotStart(s),'JST',targetTZ);
    const cEnd=slotEnd(s)?convertTime(slotEnd(s),'JST',targetTZ):'';
    const cStr=cEnd?cStart+' - '+cEnd:cStart+' onwards';
    msg+=`  ${cStr} ${targetTZ}\n`;
  }
  msg+='\n';
  if(orgMsg)msg+=orgMsg+'\n\n';
  if(attendees.length)msg+=`Confirmed attendees: ${attendees.join(', ')}\n\n`;
  msg+=`Please add this to your calendar and let me know if anything changes.\n\n`;
  msg+=`Best regards`;

  const btn=box.querySelector('.copy-btn');
  box.textContent=msg;
  box.prepend(btn);
}

function copyShare(btn){
  const box=document.getElementById('shareBox');
  const text=[...box.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('');
  navigator.clipboard.writeText(text.trim()).then(()=>{
    btn.textContent='COPIED!';btn.classList.add('copied');
    setTimeout(()=>{btn.textContent='COPY';btn.classList.remove('copied')},1500);
  });
}

function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}

// ============ TABS ============
function switchTab(name){
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===name));
  document.querySelectorAll('.panel').forEach(p=>p.classList.toggle('active',p.id==='panel-'+name));
  if(name==='vote'){renderEventHeader();renderVoteForm();renderRespList()}
  if(name==='result'){renderEventHeader();renderFinalizeList();renderShareMessage()}
}
document.querySelectorAll('.tab').forEach(t=>{t.onclick=()=>switchTab(t.dataset.tab)});

// ============ INIT ============
renderThemeSwitch();
initConverter();
renderSlots();
currentVote=slots.map(()=>'');
