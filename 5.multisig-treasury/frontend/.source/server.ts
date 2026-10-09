// @ts-nocheck
import * as __fd_glob_0 from "../../docs/index.md?collection=docs"
import * as __fd_glob_1 from "../../docs/bai_giang_1.md?collection=docs"
import * as __fd_glob_2 from "../../docs/bai_giang_2.md?collection=docs"
import * as __fd_glob_3 from "../../docs/bai_giang_3.md?collection=docs"
import { server } from 'fumadocs-mdx/runtime/server';
import type * as Config from '../source.config';

const create = server<typeof Config, import("fumadocs-mdx/runtime/types").InternalTypeConfig & {
  DocData: {
  }
}>({"doc":{"passthroughs":["extractedReferences"]}});

export const docs = await create.docs("docs", "../docs", {}, {
  "index.md": __fd_glob_0,
  "bai_giang_1.md": __fd_glob_1,
  "bai_giang_2.md": __fd_glob_2,
  "bai_giang_3.md": __fd_glob_3,
});