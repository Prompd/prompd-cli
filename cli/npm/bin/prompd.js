#!/usr/bin/env node

// Simple wrapper to handle both development and production environments
const path = require('path');
const fs = require('fs');

// Check if we're running from built dist or source
const distPath = path.join(__dirname, '..', 'dist', 'index.js');
const srcPath = path.join(__dirname, '..', 'src', 'index.ts');

if (fs.existsSync(distPath)) {
  // Production: use built JavaScript
  require(distPath);
} else if (fs.existsSync(srcPath)) {
  // Development: use TypeScript with ts-node
  require('ts-node').register({
    project: path.join(__dirname, '..', 'tsconfig.json')
  });
  require(srcPath);
} else {
  console.error('Error: Could not find prompd CLI files. Please run "npm run build" first.');
  process.exit(1);
}