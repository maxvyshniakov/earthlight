/** Owns popover positioning, dragging and their event lifecycle. No renderer state. */
export function createScenePanels(root:HTMLElement,controls:HTMLElement,settingsToggle:HTMLElement){
    const panels = [...root.querySelectorAll<HTMLElement>('.sky-panel')];
    const panelHeaders=panels.map(panel=>panel.querySelector<HTMLElement>('.panel-header')!);
    const panelPositions=new Map<HTMLElement,{left:number;top:number}>();
    let panelDrag:{panel:HTMLElement;header:HTMLElement;pointer:number;x:number;y:number;left:number;top:number}|null=null;
    const placePanel=(panel:HTMLElement,left:number,top:number)=>{
      const position={left:Math.max(16,Math.min(left,document.documentElement.clientWidth-panel.offsetWidth-16)),
        top:Math.max(16,Math.min(top,document.documentElement.clientHeight-panel.offsetHeight-16))};
      panel.style.left=`${position.left}px`;panel.style.top=`${position.top}px`;
      return position;
    };
    const positionPanels = () => {
      if(panelDrag&&!panelDrag.panel.matches(':popover-open'))endPanelDrag();
      for(const panel of panels){
        if(!panel.matches(':popover-open'))continue;
        const saved=panelPositions.get(panel);
        if(saved){panelPositions.set(panel,placePanel(panel,saved.left,saved.top));continue;}
        const rect=(panel.id==='sky-settings'?settingsToggle:controls).getBoundingClientRect();
        const above=rect.top-panel.offsetHeight-12;
        placePanel(panel,rect.left,above>=16?above:rect.bottom+12);
      }
    };
    const endPanelDrag=(event?:PointerEvent)=>{
      if(!panelDrag||(event&&event.pointerId!==panelDrag.pointer))return;
      const {panel,header,pointer}=panelDrag;
      panelDrag=null;delete panel.dataset.dragging;
      if(header.hasPointerCapture(pointer))header.releasePointerCapture(pointer);
    };
    const startPanelDrag=(event:PointerEvent)=>{
      if(!event.isPrimary||event.button!==0||(event.target as Element).closest('button,a,input'))return;
      const header=event.currentTarget as HTMLElement,panel=header.closest<HTMLElement>('.sky-panel')!;
      const rect=panel.getBoundingClientRect();
      panelDrag={panel,header,pointer:event.pointerId,x:event.clientX,y:event.clientY,left:rect.left,top:rect.top};
      header.setPointerCapture(event.pointerId);panel.dataset.dragging='';event.preventDefault();
    };
    const movePanelDrag=(event:PointerEvent)=>{
      if(!panelDrag||event.pointerId!==panelDrag.pointer)return;
      const {panel,left,top,x,y}=panelDrag;
      panelPositions.set(panel,placePanel(panel,left+event.clientX-x,top+event.clientY-y));
    };
    const closePanels = () => panels.forEach(panel=>{
      if(panel.matches(':popover-open'))panel.hidePopover();
    });
    panels.forEach(panel=>panel.addEventListener('toggle',positionPanels));
    panelHeaders.forEach(header=>{
      header.addEventListener('pointerdown',startPanelDrag);
      header.addEventListener('pointermove',movePanelDrag);
      header.addEventListener('pointerup',endPanelDrag);
      header.addEventListener('pointercancel',endPanelDrag);
      header.addEventListener('lostpointercapture',endPanelDrag);
    });
    window.addEventListener('resize',positionPanels);
    window.addEventListener('scroll',positionPanels,{passive:true});
    return {position:positionPanels,close:closePanels,dispose(){
      closePanels();
      endPanelDrag();
      panels.forEach(panel=>panel.removeEventListener('toggle',positionPanels));
      panelHeaders.forEach(header=>{
        header.removeEventListener('pointerdown',startPanelDrag);
        header.removeEventListener('pointermove',movePanelDrag);
        header.removeEventListener('pointerup',endPanelDrag);
        header.removeEventListener('pointercancel',endPanelDrag);
        header.removeEventListener('lostpointercapture',endPanelDrag);
      });
      window.removeEventListener('resize',positionPanels);
      window.removeEventListener('scroll',positionPanels);
    }};
}
