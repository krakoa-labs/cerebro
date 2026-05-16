import figma from "@figma/code-connect";
import { Card } from "./Card";

figma.connect(Card, "<FIGMA_CARD>", {
  example: () => Card,
});
