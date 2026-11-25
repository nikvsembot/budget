// Rebuilds /vendor (no CDN at runtime): Preact+htm, Firebase, and the Tesseract receipt reader.
//   npm install && node scripts/vendor.mjs
import { build } from 'esbuild';
import fs from 'node:fs/promises';

await fs.mkdir('vendor/tesseract/core', { recursive: true });
await fs.mkdir('vendor/tesseract/lang', { recursive: true });
await fs.writeFile('vendor/_ui.js', `
export { h, render, Fragment } from 'preact';
export { useState, useEffect, useMemo, useRef, useCallback, useReducer } from 'preact/hooks';
import htm from 'htm';
import { h } from 'preact';
export const html = htm.bind(h);
`);
await fs.writeFile('vendor/_firebase.js', `
export { initializeApp } from 'firebase/app';
export { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut, browserLocalPersistence, setPersistence } from 'firebase/auth';
export { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, collection, onSnapshot, setDoc, getDoc, deleteDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
`);
for (const [entry, out] of [['vendor/_ui.js', 'vendor/ui.mjs'], ['vendor/_firebase.js', 'vendor/firebase.mjs']]) {
  await build({ entryPoints: [entry], bundle: true, format: 'esm', minify: true, outfile: out, target: 'es2020', legalComments: 'none' });
  await fs.rm(entry);
}
const nm = 'node_modules/';
await fs.copyFile(nm + 'tesseract.js/dist/tesseract.esm.min.js', 'vendor/tesseract/tesseract.esm.min.js');
await fs.copyFile(nm + 'tesseract.js/dist/worker.min.js', 'vendor/tesseract/worker.min.js');
for (const f of ['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'])
  await fs.copyFile(nm + 'tesseract.js-core/' + f, 'vendor/tesseract/core/' + f);
for (const l of ['jpn', 'eng', 'rus'])
  await fs.copyFile(`${nm}@tesseract.js-data/${l}/4.0.0_best_int/${l}.traineddata.gz`, `vendor/tesseract/lang/${l}.traineddata.gz`);
console.log('vendor/ rebuilt');
