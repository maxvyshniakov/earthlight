export type AtlasEntry={slot:number;loaded:number;used:number};
/** Paired atlas cells. Infinity reserves both cells until every upload settles.
 * Cancellation alone cannot release a reservation: an asynchronous bitmap crop
 * or upload may still be using it. Only the owning job releases/completes it. */
export class AtlasResidency<Key,Entry extends AtlasEntry=AtlasEntry>{
  readonly entries=new Map<Key,Entry>();
  constructor(private first:number,private end:number){}
  /** Do not admit cached decodes again while every candidate slot is pinned.
   * The pending owner's settlement or next view update will retry admission. */
  canReserve(wanted:readonly Key[]){
    return this.entries.size<Math.floor((this.end-this.first)/2)||[...this.entries].some(([key,entry])=>Number.isFinite(entry.loaded)&&!wanted.includes(key));
  }
  reserve(key:Key,wanted:readonly Key[],now:number,metadata:Omit<Entry,keyof AtlasEntry>):Entry|null{
    if(this.entries.has(key))return null;
    const occupied=new Set([...this.entries.values()].map(e=>e.slot));
    let slot=0;
    for(let i=this.first;i<this.end-1;i+=2)if(!occupied.has(i)){slot=i;break;}
    if(!slot){
      const stale=[...this.entries].filter(([id,e])=>!wanted.includes(id)&&Number.isFinite(e.loaded)).sort((a,b)=>a[1].used-b[1].used)[0];
      if(!stale)return null;
      slot=stale[1].slot;this.entries.delete(stale[0]);
    }
    const entry={...metadata,slot,loaded:Infinity,used:now} as Entry;
    this.entries.set(key,entry);return entry;
  }
  complete(key:Key,entry:Entry,now:number){
    if(this.entries.get(key)!==entry)return false;
    entry.loaded=now;entry.used=now;return true;
  }
  release(key:Key,entry:Entry){if(this.entries.get(key)===entry)this.entries.delete(key);}
  touch(wanted:readonly Key[],now:number){for(const key of wanted){const entry=this.entries.get(key);if(entry)entry.used=now;}}
  clear(){this.entries.clear();}
}

export type TileRequest={controller:AbortController;timedOut:boolean;timer:ReturnType<typeof setTimeout>};
/** Per-owner request identity, cancellation and retry deadlines. Scheduling
 * stays in SceneWork and each source retains its concurrency/timeout policy. */
export class TileRequests<Key>{
  readonly pending=new Map<Key,TileRequest>();
  private failed=new Map<Key,number>();
  private disposed=false;
  constructor(private now=()=>performance.now()){}
  begin(key:Key,timeoutMs:number,onTimeout?:()=>void):TileRequest|null{
    if(this.disposed||this.pending.has(key)||(this.failed.get(key)??0)>this.now())return null;
    const request:TileRequest={controller:new AbortController(),timedOut:false,timer:0 as unknown as ReturnType<typeof setTimeout>};
    request.timer=setTimeout(()=>{request.timedOut=true;request.controller.abort();onTimeout?.();},timeoutMs);
    this.pending.set(key,request);return request;
  }
  current(key:Key,request:TileRequest){return !this.disposed&&this.pending.get(key)===request&&!request.controller.signal.aborted;}
  fail(key:Key,request:TileRequest,retryMs:number){if(!this.disposed&&this.pending.get(key)===request)this.failed.set(key,this.now()+retryMs);}
  finish(key:Key,request:TileRequest){clearTimeout(request.timer);if(this.pending.get(key)===request)this.pending.delete(key);}
  retain(wanted:readonly Key[]){for(const [key,request] of this.pending)if(!wanted.includes(key))request.controller.abort();}
  dispose(){this.disposed=true;for(const request of this.pending.values()){clearTimeout(request.timer);request.controller.abort();}this.pending.clear();this.failed.clear();}
}
