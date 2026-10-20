/** Content identity is independent of catalogue timestamps and object order. */
export async function publicationRevision(files:Record<string,{sha256:string}>){
 const content=Object.keys(files).sort().map(key=>`${key}:${files[key].sha256}`).join('\n');
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(content));
 return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}
