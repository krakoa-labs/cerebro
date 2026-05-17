import type { Locale } from "date-fns";
import { tokens } from "@/theme/tokens";
import "@acme/design-tokens/tokens.css";

export const Card = (props: { locale: Locale }) => tokens && props.locale;
