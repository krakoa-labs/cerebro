import figma from "@figma/code-connect";
import { Button } from "./Button";

figma.connect(Button, "https://figma.com/design/abc?node-id=1-1", {
  example: () => Button,
});

figma.connect(Button, "https://figma.com/design/abc?node-id=1-2", {
  variant: { Size: "Large" },
  example: () => Button,
});
