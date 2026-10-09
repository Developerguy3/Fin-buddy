import {sha256} from '@noble/hashes/sha2.js';
export function createHash(){let value='';return {update(text){value+=String(text);return this;},digest(){return Array.from(sha256(new TextEncoder().encode(value)),b=>b.toString(16).padStart(2,'0')).join('');}};}
export const randomUUID=()=>globalThis.crypto.randomUUID();
