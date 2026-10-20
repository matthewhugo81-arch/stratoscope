/** Content identity is independent of catalogue timestamps and object order. */
export async function publicationRevision(files:Record<string,{sha256:string}>){
 const content=Object.keys(files).sort().map(key=>`${key}:${files[key].sha256}`).join('\n');
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(content));
 return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}

// A delayed response or stale CDN must not invalidate the newer publication
// still displayed by the page. Call immediately before replacing a manifest.
export function assertPublicationProgress(previous:{run:string;preparedAt:string}|undefined,next:{run:string;preparedAt:string}){
 if(previous&&(Date.parse(next.run)<Date.parse(previous.run)||next.run===previous.run&&Date.parse(next.preparedAt)<Date.parse(previous.preparedAt))){
  throw Error('The source returned an older forecast catalogue. Keeping the current verified publication.');
 }
}
