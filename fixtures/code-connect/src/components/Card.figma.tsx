import figma from "@figma/code-connect";
import { Card } from "./Card";

figma.connect(Card, "https://figma.com/design/abc?node-id=2-1", {
  example: () => Card,
});
