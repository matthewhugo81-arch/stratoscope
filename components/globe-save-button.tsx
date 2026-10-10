'use client';
import {useEffect,useRef,useState} from 'react';
import {Download,LoaderCircle,Share2,X} from 'lucide-react';
import {downloadBlob} from '@/lib/image-export';
import type {GlobeImage} from '@/lib/globe-image';

type Ready=GlobeImage&{url:string;file:File;shareable:boolean};
export function GlobeSaveButton({disabled,onPrepare}:{disabled:boolean;onPrepare:()=>Promise<GlobeImage>}){
 const [busy,setBusy]=useState(false),[ready,setReady]=useState<Ready|null>(null),[error,setError]=useState('');
 const dialog=useRef<HTMLDialogElement>(null),button=useRef<HTMLButtonElement>(null),active=useRef(false),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;}},[]);
 useEffect(()=>{
  if(!ready)return;
  const node=dialog.current;
  if(node&&!node.open)node.showModal();
  return()=>{node?.close();URL.revokeObjectURL(ready.url);button.current?.focus({preventScroll:true});};
 },[ready]);
 async function prepare(){
  if(disabled||active.current)return;
  active.current=true;setBusy(true);setError('');
  // A preview gives mobile users a visible image rather than claiming a hidden
  // anchor click saved a file. Desktop keeps its existing one-click download.
  const mobile=window.matchMedia('(pointer: coarse), (max-width: 750px)').matches;
  try{
   const image=await onPrepare();
   if(!mounted.current)return;
   if(mobile){
    const file=new File([image.blob],image.filename,{type:'image/png'});
    let shareable=false;
    try{shareable=Boolean(navigator.share&&navigator.canShare?.({files:[file]}));}catch{}
    setReady({...image,file,shareable,url:URL.createObjectURL(image.blob)});
   }else downloadBlob(image.blob,image.filename);
  }catch(e){if(mounted.current)setError(e instanceof Error?e.message:'The image could not be prepared.');}
  finally{active.current=false;if(mounted.current)setBusy(false);}
 }
 async function share(){
  if(!ready||active.current)return;
  active.current=true;setError('');
  try{
   // The File already exists: invoke share directly from this new user gesture,
   // before any await, so iOS transient activation is retained.
   await navigator.share({files:[ready.file],title:ready.title});
  }catch(e){
   if(!(e instanceof DOMException&&e.name==='AbortError'))setError('Sharing is unavailable. Use Download PNG or touch and hold the image.');
  }finally{active.current=false;}
 }
 return <div className="globe-save-control">
  <button ref={button} type="button" className="image-save" title="Save the current globe as PNG" aria-label="Save globe image" disabled={disabled||busy} onClick={()=>void prepare()}>
   {busy?<LoaderCircle size={13} className="animate-spin" aria-hidden="true"/>:<Download size={13} aria-hidden="true"/>}<span>{busy?'Preparing…':'Save'}</span>
  </button>
  {error&&!ready&&<small className="globe-save-error" role="status">{error}</small>}
  {ready&&<dialog ref={dialog} className="globe-save-dialog" aria-labelledby="globe-save-title" onCancel={()=>{setReady(null);setError('');}}>
   <header><h2 id="globe-save-title">Save globe image</h2><button type="button" aria-label="Close image preview" onClick={()=>{setReady(null);setError('');}}><X size={18}/></button></header>
   <img src={ready.url} alt={ready.title+' — PNG preview'} className="globe-save-preview"/>
   <p>{ready.shareable?'Tap Share / Save for your device’s save options. You can also touch and hold the image.':'Touch and hold the image to save it, or use Download PNG.'}</p>
   <div className="globe-save-actions">
    {ready.shareable&&<button type="button" onClick={()=>void share()}><Share2 size={16}/>Share / Save</button>}
    <a href={ready.url} download={ready.filename}>Download PNG</a>
   </div>
   {error&&<p className="globe-save-error" role="status">{error}</p>}
  </dialog>}
 </div>;
}
