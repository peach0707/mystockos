export function applyAppearance(value='system'){
 const mode=value==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):value;
 document.documentElement.dataset.appearance=mode;
 document.querySelector('meta[name="theme-color"]')?.setAttribute('content',mode==='dark'?'#111820':'#f6f7f9');
}
