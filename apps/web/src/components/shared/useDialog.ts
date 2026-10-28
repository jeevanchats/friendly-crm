'use client';
import { useEffect, useRef } from 'react';
export function useDialog(open: boolean, onClose?: () => void) {
 const ref = useRef<HTMLDivElement>(null);
 const close = useRef(onClose); close.current = onClose;
 useEffect(() => {
  const dialog = ref.current; if (!open || !dialog) return;
  const previous = document.activeElement as HTMLElement | null;
  const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
  const isolated: {element: HTMLElement; inert: boolean}[] = [];
  let branch: HTMLElement = dialog;
  while (branch.parentElement && branch !== document.body) {
   for (const sibling of Array.from(branch.parentElement.children)) {
    if (sibling instanceof HTMLElement && sibling !== branch) {
     isolated.push({element: sibling, inert: sibling.inert}); sibling.inert = true;
    }
   }
   branch = branch.parentElement;
  }
  const items = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]')).filter(el => el.getClientRects().length > 0 && !el.closest('[inert]'));
  const frame = requestAnimationFrame(() => (items()[0] || dialog).focus());
  const key = (e: KeyboardEvent) => {
   if (e.key === 'Escape' && close.current) { e.preventDefault(); close.current(); }
   if (e.key !== 'Tab') return;
   const list=items(), first=list[0], last=list[list.length-1];
   if (!first) {e.preventDefault();dialog.focus();return;}
   if (e.shiftKey && (document.activeElement===first || document.activeElement===dialog)) {e.preventDefault();last.focus();}
   else if (!e.shiftKey && document.activeElement===last) {e.preventDefault();first.focus();}
  };
  dialog.addEventListener('keydown',key);
  return () => {cancelAnimationFrame(frame);dialog.removeEventListener('keydown',key);document.body.style.overflow=overflow;isolated.reverse().forEach(x=>{x.element.inert=x.inert;});if(previous?.isConnected)previous.focus();};
 },[open]);
 return ref;
}
