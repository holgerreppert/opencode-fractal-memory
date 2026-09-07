declare module '@opentui/solid/jsx-runtime' {
  import { JSX } from 'solid-js';
  export function jsx(type: string, props: any, key?: string): any;
  export function jsxs(type: string, props: any, key?: string): any;
  export function jsxDEV(type: string, props: any, key?: string): any;
  export function Fragment(props: any): any;
}
declare namespace JSX {
  interface IntrinsicElements {
    box: any;
    text: any;
    [elem: string]: any;
  }
}