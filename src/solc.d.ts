declare module 'solc' {
  const solc: { compile: (source: string) => string };
  export default solc;
}
