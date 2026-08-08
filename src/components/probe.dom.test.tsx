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
/** REAL browser sequence: pointerdown, mousedown (focus moves unless prevented), up, click */
function realClick(el:Element){
  act(()=>{
    el.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,cancelable:true,button:0}));
    const md=new MouseEvent("mousedown",{bubbles:true,cancelable:true,button:0});
    el.dispatchEvent(md);
    if(!md.defaultPrevented){ const a=document.activeElement as HTMLElement|null; a?.blur?.(); }
    el.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,cancelable:true,button:0}));
    el.dispatchEvent(new MouseEvent("mouseup",{bubbles:true,cancelable:true,button:0}));
    el.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,button:0}));
  });
}
function typeInto(input:HTMLInputElement, value:string){
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!;
  act(()=>{ setter.call(input,value); input.selectionStart=value.length; input.selectionEnd=value.length; input.dispatchEvent(new Event("input",{bubbles:true})); });
}
describe("probe", () => {
  it("cell click during pick", () => {
    act(()=>createRoot(host).render(<Harness/>));
    realClick(cell(0,0));
    act(()=>{ cell(0,0).dispatchEvent(new MouseEvent("dblclick",{bubbles:true})); });
    const inp=editor()!; typeInto(inp,"=");
    realClick(cell(1,1));
    console.log("after cell pick: editor=", editor()?.value, "active=", document.activeElement?.getAttribute("data-sheet-editor"));
    expect(editor()).toBeTruthy();
  });
  it("suggestion click", () => {
    act(()=>createRoot(host).render(<Harness/>));
    realClick(cell(0,0));
    act(()=>{ cell(0,0).dispatchEvent(new MouseEvent("dblclick",{bubbles:true})); });
    const inp=editor()!; typeInto(inp,"=SU");
    const row=host.querySelector('[data-sheet-suggestion="SUM"]') as HTMLElement;
    console.log("row?", !!row);
    realClick(row);
    console.log("after sug click: editor=", editor()?.value);
    expect(editor()).toBeTruthy();
  });
});
