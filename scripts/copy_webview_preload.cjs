#!/usr/bin/env node
const { copyFileSync, mkdirSync } = require('fs')
const { dirname, resolve } = require('path')

const root = resolve(__dirname, '..')
const source = resolve(root, 'src/preload/webview-preload.cjs')
const target = resolve(root, 'out/preload/webview-preload.cjs')

mkdirSync(dirname(target), { recursive: true })
copyFileSync(source, target)
console.log(`copied ${source} -> ${target}`)
