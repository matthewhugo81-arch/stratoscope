'use client';
import {useState} from 'react';
import {Download,LoaderCircle} from 'lucide-react';

/** Small, unobtrusive export control; never starts a download without a click. */
export function SaveImageButton({onSave,disabled=false,description='chart',className=''}:{
 onSave:()=>Promise<void>;
 disabled?:boolean;
 description?:string;
 className?:string;
}){
 const [saving,setSaving]=useState(false),[error,setError]=useState('');
 async function save(){
  if(saving||disabled)return;
  setSaving(true);setError('');
  try{await onSave()}catch(e){setError(e instanceof Error?e.message:'The PNG could not be saved.');}
  finally{setSaving(false);}
 }
 return <span className={'image-save-wrap '+className}>
  <button type="button" className="image-save-button" disabled={saving||disabled} onClick={()=>void save()} title={'Save '+description+' as PNG'} aria-label={'Save '+description+' as PNG'}>
   {saving?<LoaderCircle size={13} className="spin" aria-hidden="true"/>:<Download size={13} aria-hidden="true"/>}<span>{saving?'Saving…':'Save'}</span>
  </button>
  {error&&<span className="image-save-error" role="alert" title={error}>Save failed: {error}</span>}
 </span>;
}
