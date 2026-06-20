/// <reference types="vite/client" />

// Type declarations for our application
declare module '*.svg' {
  const content: string;
  export default content;
}

declare module '*.png' {
  const content: string;
  export default content;
}
