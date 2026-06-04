declare module "@opentui/solid/jsx-runtime" {
  export function jsx(type: any, props: any, ...rest: any[]): any;
  export function jsxs(type: any, props: any, ...rest: any[]): any;
  export function Fragment(props: any): any;
}

type BorderColor = string;
type Padding = number;
type FlexDirection = "row" | "column";
type Gap = number;
type FgColor = string;

interface BoxProps {
  border?: boolean;
  borderColor?: BorderColor;
  backgroundColor?: string;
  paddingTop?: Padding;
  paddingBottom?: Padding;
  paddingLeft?: Padding;
  paddingRight?: Padding;
  flexDirection?: FlexDirection;
  gap?: Gap;
  children?: any;
}

interface TextProps {
  fg?: FgColor;
  children?: any;
}

interface BProps {
  children?: any;
}

declare namespace JSX {
  interface Element {}
  interface IntrinsicElements {
    box: BoxProps;
    text: TextProps;
    b: BProps;
  }
}
