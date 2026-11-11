import { compileSdf, generateSurface } from "./sdf.mjs";

self.onmessage = ({ data: { source, options } }) => {
  try {
    const result = generateSurface(compileSdf(source), options);
    self.postMessage({ result }, [result.data.buffer]);
  } catch (error) {
    self.postMessage({ error: String(error?.message ?? error) });
  }
};
