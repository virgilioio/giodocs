// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act, useState } from "react";
import { SheetBlockView } from "@/components/sheet-block";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const block = { id: "s1", type: "sheet", cells: [[{v:"a"},{v:"b"}],[{v:1},{v:2}],[{v:3},{v:4}]], cw: [160,120] };
let host: HTMLDivElement;
beforeEach(() => { document.body.innerHTML=""; host=document.createElement("div"); document.body.appendChild(host); });
function Harness(){ const [b,setB]=useState<Record<string,unknown>>(block);
  return <SheetBlockView block={b} onChange={(p)=>setB(prev=>({...prev,...p}))} />; }
const cell=(r:number,c:number)=>host.querySelector(`[data-sheet-cell="${r},${c}"]`) as HTMLElement;
const editor=()=>host.querySelector("[data-sheet-editor]") as HTMLInputElement|null;
const grid=()=>host.querySelector('[role="table"]') as HTMLElement;
function click(el:Element){act(()=>{el.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,button:0}));el.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,button:0}));});}
function press(el:Element,key:string){act(()=>{el.dispatchEvent(new KeyboardEvent("keydown",{key,bubbles:true,cancelable:true}));});}
function realClick(el:Element){
  let prevented=false;
  act(()=>{
    el.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,cancelable:true,button:0}));
    const md=new MouseEvent("mousedown",{bubbles:true,cancelable:true,button:0});
    el.dispatchEvent(md); prevented=md.defaultPrevented;
    if(!md.defaultPrevented){(document.activeElement as HTMLElement|null)?.blur?.();}
    el.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,cancelable:true,button:0}));
    el.dispatchEvent(new MouseEvent("mouseup",{bubbles:true,cancelable:true,button:0}));
    el.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,button:0}));
  });
  return prevented;
}
describe("dbg",()=>{ it("x",()=>{
  act(()=>createRoot(host).render(<Harness/>));
  click(cell(1,0)); press(grid(),"=");
  console.log("after =", editor()?.value, editor()?.selectionStart);
  const p1=realClick(host.querySelector('[data-sheet-suggestion="SUM"]')!);
  console.log("sug prevented",p1,"val",editor()?.value,"caret",editor()?.selectionStart);
  const p2=realClick(cell(1,1));
  console.log("cell prevented",p2,"val",editor()?.value);
});});
