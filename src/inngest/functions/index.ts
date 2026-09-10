import { pullCrelateNightly, pullCrelateOnDemand } from "./pullCrelate";
import { pullQuickBooksNightly, pullQuickBooksOnDemand } from "./pullQuickBooks";
import { nightlyReconcile } from "./nightlyReconcile";

export const inngestFunctions = [
  pullCrelateNightly,
  pullCrelateOnDemand,
  pullQuickBooksNightly,
  pullQuickBooksOnDemand,
  nightlyReconcile,
];
