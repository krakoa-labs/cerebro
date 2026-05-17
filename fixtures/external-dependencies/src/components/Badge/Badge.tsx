import { Dialog } from "@radix-ui/react-dialog/dist/index";
import debounce from "lodash/debounce";
import { decorate } from "./badge-utils";

export const Badge = () => decorate(debounce(Dialog));
