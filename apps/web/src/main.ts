import { SENN_CORE_VERSION } from "@senn/core";
import { SENN_PROTOCOL_VERSION } from "@senn/protocol";

const status = document.querySelector<HTMLElement>("#status");
if (status) {
  const line = document.createElement("p");
  line.textContent = `Core ${SENN_CORE_VERSION} · Protocol ${SENN_PROTOCOL_VERSION}`;
  status.append(line);
}
