import { generateScene } from "./scene.mjs";

self.onmessage = ({ data: { source, options } }) => {
  try {
    const result = generateScene(source, options, progress => self.postMessage({ progress }));
    self.postMessage({ result }, [result.data.buffer]);
  } catch (error) {
    self.postMessage({ error: String(error?.message ?? error) });
  }
};
