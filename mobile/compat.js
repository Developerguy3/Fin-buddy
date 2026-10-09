if(!Promise.withResolvers)Promise.withResolvers=function(){let resolve,reject;const promise=new Promise((ok,no)=>{resolve=ok;reject=no;});return {promise,resolve,reject};};
