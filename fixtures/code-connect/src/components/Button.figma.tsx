import figma from "@figma/code-connect";
import { Button } from "./Button";

figma.connect(Button, "https://figma.com/design/abc?node-id=1-1", {
  example: () => Button,
});

figma.connect(Button, "https://www.figma.com/design/abc/Buttons?node-id=1-2", {
  variant: { Size: "Large", Disabled: true },
  example: () => Button,
});
