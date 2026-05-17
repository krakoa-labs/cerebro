import { useMemo } from "react";
import { Icon } from "@/components/Icon/Icon";
import { clamp } from "./utils";

export const Modal = () => useMemo(() => [Icon, clamp(1)], []);
