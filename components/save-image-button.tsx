'use client';
import {useState} from 'react';
import {Download} from 'lucide-react';
import {saveElementPng,type PngExport} from '@/lib/save-png';

type Props=PngExport&{
 target?:()=>HTMLElement|SVGElement|null;
 onSave?:()=>Promise<void>;
 disabled?:boolean;
};

/** Subdued chart action, omitted from its own exported PNG. */
export function SaveImageButton({target,onSave,disabled=false,...meta}:Props){
 const [saving,setSaving]=useState(false),[error,setError]=useState('');
 async function save(){
  if(saving||disabled)return;
  setSaving(true);setError('');
  try{
   if(onSave)await onSave();
   else await saveElementPng(target?.()??null,meta);
  }catch(e){
   setError(e instanceof Error?e.message:'Image could not be saved.');
  }finally{setSaving(false)}
 }
 return <span className="image-save-wrap" data-save-exclude>
  <button type="button" className="image-save-button" aria-label={`Save ${meta.title} as PNG`}
   title={saving?'Preparing PNG…':'Save current view as PNG'} disabled={disabled||saving} onClick={()=>void save()}>
   <Download size={14} aria-hidden="true"/><span>{saving?'Saving…':'Save'}</span>
  </button>
  {error&&<small className="image-save-error" role="status">{error}</small>}
 </span>;
}
