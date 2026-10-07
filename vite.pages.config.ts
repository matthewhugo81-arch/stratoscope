import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath,URL} from 'node:url';
export default defineConfig({
 base:'/stratoscope/',
 plugins:[react()],
 resolve:{alias:{'@':fileURLToPath(new URL('.',import.meta.url))}},
 define:{__STRATOSCOPE_STATIC__:true},
 build:{outDir:'docs',emptyOutDir:true},
 worker:{format:'es'},
 server:{host:'127.0.0.1',port:5174,strictPort:true},
});
