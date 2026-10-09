import {pipeline,env} from '@huggingface/transformers';
import path from 'node:path';
env.allowRemoteModels=false;env.localModelPath=path.join(import.meta.dirname,'models')+path.sep;
const generator=await pipeline('text-generation','onnx-community/SmolLM2-135M-Instruct-ONNX',{dtype:'q4',device:'cpu'});
const result=await generator([{role:'user',content:'Reply with one word: hello'}],{max_new_tokens:8,do_sample:false});
console.log('Bundled model inference succeeded:',JSON.stringify(result));await generator.dispose();
