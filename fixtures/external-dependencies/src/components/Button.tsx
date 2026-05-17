import { useState } from "react";
import { createPortal } from "react-dom";
import { sep } from "node:path";

export const Button = () => {
  const [label] = useState(sep);
  return createPortal(label, document.body);
};
