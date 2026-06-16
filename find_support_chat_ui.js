import fs from 'fs';

const content = fs.readFileSync('shell.js', 'utf8');
const lines = content.split('\n');
lines.forEach((line, index) => {
  if (line.includes('supportChat') || line.includes('SupportChat') || line.includes('chatInput') || line.includes('message') || line.includes('file') || line.includes('upload')) {
    if (line.includes('<input') || line.includes('form') || line.includes('button') || line.includes('id=')) {
      console.log(`${index + 1}: ${line.trim()}`);
    }
  }
});
