'use client';
import {useState} from 'react';
import {Download,LoaderCircle} from 'lucide-react';

/** Small, accessible export control; no automatic data requests or screenshot service. */
export function SaveImageButton({onSave,disabled=false,label='Save',className=''}:
 {onSave:()=>Promise<void>;disabled?:boolean;label?:string;className?:string}){
 const [saving,setSaving]=useState(false),[status,setStatus]=useState('');
 return <span className={'image-save-wrap '+className}>
  <button type="button" className="image-save" disabled={disabled||saving}
    title={disabled?'Chart not ready':status.startsWith('Could not')?status:'Save the displayed view as a PNG'}
    aria-label={label==='Save'?'Save image as PNG':label+' as PNG'}
    onClick={async()=>{if(disabled||saving)return;setSaving(true);setStatus('');try{await onSave();setStatus('Saved PNG');}catch(e){setStatus('Could not save PNG: '+(e instanceof Error?e.message:'Unexpected error'));}finally{setSaving(false);}}}>
   {saving?<LoaderCircle size={13} className="spin" aria-hidden="true"/>:<Download size={13} aria-hidden="true"/>}
   <span>{saving?'Saving…':label}</span>
  </button>
  {status&&<span className={'image-save-status'+(status.startsWith('Could not')?' image-save-error':'')} role="status">{status}</span>}
 </span>;
}
