import fs from 'node:fs/promises';
const file=new URL('ios/App/CapApp-SPM/Package.swift',import.meta.url),source=await fs.readFile(file,'utf8');await fs.writeFile(file,source.replaceAll('\\','/'));
