// @ts-nocheck
import { browser } from 'fumadocs-mdx/runtime/browser';
import type * as Config from '../source.config';

const create = browser<typeof Config, import("fumadocs-mdx/runtime/types").InternalTypeConfig & {
  DocData: {
  }
}>();
const browserCollections = {
  docs: create.doc("docs", {
    "index.md": () => import("../../docs/index.md?collection=docs"),
    "bai_giang_1.md": () => import("../../docs/bai_giang_1.md?collection=docs"),
    "bai_giang_2.md": () => import("../../docs/bai_giang_2.md?collection=docs"),
    "bai_giang_3.md": () => import("../../docs/bai_giang_3.md?collection=docs"),
  }),
};
export default browserCollections;