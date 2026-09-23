import {
  CaretRightIcon,
  HardDrivesIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  StarIcon,
} from '@phosphor-icons/react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatCount } from '../lib/format';
import { flattenTags, type FolderNode, type TagNode } from '../lib/ipc';
import { useRenderTiming } from '../lib/profile';
import { tagPalette } from '../lib/tagColors';
import { FolderMenu, type FolderAction } from './FolderMenu';

interface Props {
  folders: FolderNode[];
  tags: TagNode[];
  selectedPath: string | null;
  selectedTagPath: string | null;
  onSelectFolder: (path: string) => void;
  onSelectTag: (path: string | null) => void;
  onAddRoot: () => void;
  onRemoveRoot: (node: FolderNode) => void;
  onManageTags: () => void;
  /** Reveal, copy, favorite, reindex (expand/collapse stay local). */
  onFolderAction: (action: FolderAction, folder: FolderNode) => void;
}

/** Matches `.tree-row { height: 23px }` in library.css (roots included). */
const FOLDER_ROW_HEIGHT = 23;
/** Short ease-out open/close; skip when too many rows change at once. */
const TREE_ANIM_MS = 200;
const TREE_ANIM_MAX_ROWS = 64;

/** Cubic ease-out on a 0→1 clock. */
function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function normPath(path: string): string {
  return path.replace(/\\/g, '/');
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Paths that have at least one child folder in the flat tree. */
function pathsWithChildren(folders: readonly FolderNode[]): Set<string> {
  const parents = new Set<string>();
  for (const node of folders) {
    const p = normPath(node.path);
    const slash = p.lastIndexOf('/');
    if (slash <= 0) continue;
    parents.add(p.slice(0, slash));
  }
  return parents;
}

/** Hide a row when any ancestor folder is not expanded (one-level expand). */
function isHiddenByCollapse(
  path: string,
  expanded: ReadonlySet<string>,
  folderPaths: ReadonlySet<string>,
): boolean {
  const p = normPath(path);
  let slash = p.lastIndexOf('/');
  while (slash > 0) {
    const parent = p.slice(0, slash);
    if (folderPaths.has(parent) && !expanded.has(parent)) return true;
    slash = parent.lastIndexOf('/');
  }
  return false;
}

function descendantKeys(path: string, folders: readonly FolderNode[]): string[] {
  const prefix = `${normPath(path)}/`;
  return folders.filter((n) => normPath(n.path).startsWith(prefix)).map((n) => normPath(n.path));
}

interface TreeAnim {
  entering: ReadonlySet<string>;
  exiting: ReadonlySet<string>;
  start: number;
}

export const FolderSidebar = memo(function FolderSidebar({
  folders,
  tags,
  selectedPath,
  selectedTagPath,
  onSelectFolder,
  onSelectTag,
  onAddRoot,
  onRemoveRoot,
  onManageTags,
  onFolderAction,
}: Props) {
  const { t } = useTranslation('library');
  useRenderTiming('FolderSidebar');
  const { t: tc } = useTranslation('common');
  /** Expanded folder paths. Empty = only roots after seed; expand is one level. */
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [tagsOpen, setTagsOpen] = useState(true);
  const [menu, setMenu] = useState<{ x: number; y: number; node: FolderNode } | null>(null);
  /** 0→1 while rows slide open/closed; 1 when idle. */
  const [animT, setAnimT] = useState(1);
  const animRef = useRef<TreeAnim | null>(null);
  const animTRef = useRef(1);
  const prevLogicalPathsRef = useRef<string[] | null>(null);
  const ghostPathsRef = useRef<Set<string>>(new Set());
  const [ghostEpoch, setGhostEpoch] = useState(0);

  const withChildren = useMemo(() => pathsWithChildren(folders), [folders]);
  const folderPaths = useMemo(() => new Set(folders.map((n) => normPath(n.path))), [folders]);

  /* Roots start expanded so packs are visible; nested folders stay collapsed. */
  useEffect(() => {
    setExpanded((prev) => {
      let next: Set<string> | null = null;
      for (const n of folders) {
        if (!n.is_root) continue;
        const key = normPath(n.path);
        if (prev.has(key)) continue;
        next ??= new Set(prev);
        next.add(key);
      }
      return next ?? prev;
    });
  }, [folders]);

  /* Reveal a selection from elsewhere (e.g. show parent) by expanding ancestors. */
  useEffect(() => {
    if (!selectedPath) return;
    setExpanded((prev) => {
      let next: Set<string> | null = null;
      const p = normPath(selectedPath);
      let slash = p.lastIndexOf('/');
      while (slash > 0) {
        const parent = p.slice(0, slash);
        if (folderPaths.has(parent) && !prev.has(parent) && !next?.has(parent)) {
          next ??= new Set(prev);
          next.add(parent);
        }
        slash = parent.lastIndexOf('/');
      }
      return next ?? prev;
    });
  }, [selectedPath, folderPaths]);

  const logicalVisible = useMemo(
    () => folders.filter((n) => !isHiddenByCollapse(n.path, expanded, folderPaths)),
    [folders, expanded, folderPaths],
  );

  /* Diff logical visibility and drive a short linear height tween. */
  useLayoutEffect(() => {
    const nextPaths = logicalVisible.map((n) => n.path);
    const prevPaths = prevLogicalPathsRef.current;
    prevLogicalPathsRef.current = nextPaths;

    if (prevPaths === null) return;

    const prevSet = new Set(prevPaths);
    const nextSet = new Set(nextPaths);
    const added = nextPaths.filter((p) => !prevSet.has(p));
    const removed = prevPaths.filter((p) => !nextSet.has(p));
    if (added.length === 0 && removed.length === 0) return;

    if (prefersReducedMotion() || added.length + removed.length > TREE_ANIM_MAX_ROWS) {
      ghostPathsRef.current = new Set();
      animRef.current = null;
      animTRef.current = 1;
      setAnimT(1);
      setGhostEpoch((n) => n + 1);
      return;
    }

    const now = performance.now();
    ghostPathsRef.current = new Set(removed);
    animRef.current = {
      entering: new Set(added),
      exiting: new Set(removed),
      start: now,
    };
    animTRef.current = 0;
    setAnimT(0);
    setGhostEpoch((n) => n + 1);
  }, [logicalVisible]);

  useEffect(() => {
    if (!animRef.current) return;
    let raf = 0;
    const tick = (now: number) => {
      const anim = animRef.current;
      if (!anim) {
        animTRef.current = 1;
        setAnimT(1);
        return;
      }
      const raw = Math.min(1, (now - anim.start) / TREE_ANIM_MS);
      const t = easeOutCubic(raw);
      animTRef.current = t;
      setAnimT(t);
      if (raw < 1) {
        raf = requestAnimationFrame(tick);
        return;
      }
      animRef.current = null;
      ghostPathsRef.current = new Set();
      setGhostEpoch((n) => n + 1);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [ghostEpoch]);

  const displayFolders = useMemo(() => {
    const ghosts = ghostPathsRef.current;
    if (ghosts.size === 0) return logicalVisible;
    const logical = new Set(logicalVisible.map((n) => n.path));
    return folders.filter((n) => logical.has(n.path) || ghosts.has(n.path));
    // ghostEpoch bumps when the ghost set changes
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ghostPathsRef is read intentionally
  }, [folders, logicalVisible, ghostEpoch]);

  const rowAnim = (path: string): { height: number; opacity: number } => {
    const anim = animRef.current;
    if (!anim) return { height: FOLDER_ROW_HEIGHT, opacity: 1 };
    const progress = animTRef.current;
    if (anim.entering.has(path)) {
      return { height: FOLDER_ROW_HEIGHT * progress, opacity: progress };
    }
    if (anim.exiting.has(path)) {
      const t = 1 - progress;
      return { height: FOLDER_ROW_HEIGHT * t, opacity: t };
    }
    return { height: FOLDER_ROW_HEIGHT, opacity: 1 };
  };

  const flatTags = useMemo(() => flattenTags(tags), [tags]);

  /* 2.8k folders on a large Dropbox library: only mount what is on screen. */
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: displayFolders.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const node = displayFolders[index];
      return node ? rowAnim(node.path).height : FOLDER_ROW_HEIGHT;
    },
    getItemKey: (index) => displayFolders[index]?.path ?? index,
    overscan: 8,
  });

  useLayoutEffect(() => {
    virtualizer.measure();
  }, [animT, displayFolders, virtualizer]);

  /* Keep the selected folder in view when the selection changes (for example
   * "show parent"), but not on every tree refresh. */
  const scrolledToPath = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedPath || selectedPath === scrolledToPath.current) return;
    const idx = displayFolders.findIndex((n) => n.path === selectedPath);
    if (idx < 0) return;
    scrolledToPath.current = selectedPath;
    virtualizer.scrollToIndex(idx, { align: 'auto' });
  }, [selectedPath, displayFolders, virtualizer]);

  const setExpandedPath = (path: string, nextExpanded: boolean) => {
    const key = normPath(path);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (nextExpanded) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const expandAllUnder = (path: string) => {
    const key = normPath(path);
    setExpanded((prev) => {
      const next = new Set(prev);
      next.add(key);
      for (const d of descendantKeys(path, folders)) {
        if (withChildren.has(d)) next.add(d);
      }
      return next;
    });
  };

  const collapseAllUnder = (path: string) => {
    const key = normPath(path);
    setExpanded((prev) => {
      const next = new Set(prev);
      next.delete(key);
      for (const d of descendantKeys(path, folders)) {
        next.delete(d);
      }
      return next;
    });
  };

  const toggleExpanded = (path: string, deep: boolean) => {
    const key = normPath(path);
    const isExp = expanded.has(key);
    if (deep) {
      if (isExp) collapseAllUnder(path);
      else expandAllUnder(path);
      return;
    }
    setExpandedPath(path, !isExp);
  };

  const onFolderActivate = (node: FolderNode, deep: boolean) => {
    const key = normPath(node.path);
    const wasSelected = selectedPath === node.path;
    const isExp = expanded.has(key);
    const hasKids = withChildren.has(key);
    onSelectFolder(node.path);
    if (!hasKids) return;
    if (deep) {
      if (isExp) collapseAllUnder(node.path);
      else expandAllUnder(node.path);
      return;
    }
    if (!isExp) {
      setExpandedPath(node.path, true);
    } else if (wasSelected) {
      setExpandedPath(node.path, false);
    }
  };

  const onMenuSelect = (action: FolderAction, folder: FolderNode) => {
    switch (action) {
      case 'expand':
        setExpandedPath(folder.path, true);
        return;
      case 'collapse':
        setExpandedPath(folder.path, false);
        return;
      case 'expandAll':
        expandAllUnder(folder.path);
        return;
      case 'collapseAll':
        collapseAllUnder(folder.path);
        return;
      case 'removeRoot':
        onRemoveRoot(folder);
        return;
      default:
        onFolderAction(action, folder);
    }
  };

  return (
    <aside className='sidebar'>
      <div className='sidebar-folders'>
        <div className='sidebar-header'>
          <span className='kicker'>{t('folders')}</span>
          <button
            type='button'
            className='btn-icon btn-icon-sm'
            title={t('addRoot')}
            aria-label={t('addRoot')}
            onClick={onAddRoot}
          >
            <PlusIcon size={12} />
          </button>
        </div>
        <div className='sidebar-scroll' ref={scrollRef}>
          {folders.length === 0 ? (
            <div className='sidebar-empty'>{t('noRoots')}</div>
          ) : (
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualizer.getVirtualItems().map((virtual) => {
                const node = displayFolders[virtual.index];
                if (!node) return null;
                const selected = selectedPath === node.path;
                const nodeKey = normPath(node.path);
                const hasKids = withChildren.has(nodeKey);
                const isExpanded = expanded.has(nodeKey);
                const indent = node.is_root ? 0 : 8 + Math.max(0, node.depth - 1) * 13;
                const { height: h, opacity } = rowAnim(node.path);
                return (
                  <div
                    key={node.path}
                    className={`tree-row${node.is_root ? ' root' : ''}${selected ? ' selected' : ''}${h < FOLDER_ROW_HEIGHT ? ' tree-row-animating' : ''}`}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: h,
                      opacity,
                      transform: `translateY(${String(virtual.start)}px)`,
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      onSelectFolder(node.path);
                      setMenu({ x: e.clientX, y: e.clientY, node });
                    }}
                  >
                    {indent > 0 ? <span className='tree-pad' style={{ width: indent }} /> : null}
                    {hasKids ? (
                      <button
                        type='button'
                        className='tree-caret'
                        aria-label={isExpanded ? t('collapseRoot') : t('expandRoot')}
                        aria-expanded={isExpanded}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleExpanded(node.path, e.altKey);
                        }}
                      >
                        <CaretRightIcon
                          size={9}
                          weight='bold'
                          className={`tree-caret-icon${isExpanded ? ' open' : ''}`}
                        />
                      </button>
                    ) : (
                      <span className='tree-pad tree-caret-spacer' aria-hidden />
                    )}
                    <button
                      type='button'
                      className='tree-label'
                      aria-pressed={selected}
                      onClick={(e) => {
                        onFolderActivate(node, e.altKey);
                      }}
                    >
                      {node.is_root ? (
                        <HardDrivesIcon size={13} weight='fill' className='tree-icon root-icon' />
                      ) : null}
                      <span className='tree-name'>{node.name}</span>
                      {node.favorite ? (
                        <StarIcon size={9} weight='fill' className='tree-fav' />
                      ) : null}
                      {node.is_root ? null : (
                        <span className='tree-count'>{formatCount(node.sample_count)}</span>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className='sidebar-tags'>
        <div className='sidebar-header'>
          <button
            type='button'
            className='sidebar-tags-toggle kicker'
            aria-expanded={tagsOpen}
            onClick={() => {
              setTagsOpen((open) => !open);
            }}
          >
            <CaretRightIcon
              size={9}
              weight='bold'
              className={`tree-caret-icon${tagsOpen ? ' open' : ''}`}
            />
            {tc('tags')}
          </button>
          <button
            type='button'
            className='btn-icon btn-icon-sm'
            title={t('manageTags')}
            aria-label={t('manageTags')}
            onClick={onManageTags}
          >
            <SlidersHorizontalIcon size={12} />
          </button>
        </div>
        <div className={`sidebar-tags-body${tagsOpen ? ' open' : ''}`}>
          <div className='sidebar-tags-body-inner'>
            <div className='sidebar-scroll sidebar-tags-scroll'>
              {flatTags.map(({ node, depth }) => {
                const selected = selectedTagPath === node.path;
                return (
                  <button
                    key={node.id}
                    type='button'
                    className={`tree-row tag${selected ? ' selected' : ''}`}
                    aria-pressed={selected}
                    tabIndex={tagsOpen ? 0 : -1}
                    onClick={() => {
                      onSelectTag(selected ? null : node.path);
                    }}
                  >
                    <span className='tree-pad' style={{ width: 8 + depth * 12 }} />
                    <span
                      className='tree-dot'
                      style={{ background: tagPalette(node.path, node.color).dot }}
                    />
                    <span className='tree-name'>{node.path}</span>
                    <span className='tree-count'>{formatCount(node.sample_count)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      {menu ? (
        <FolderMenu
          x={menu.x}
          y={menu.y}
          folder={menu.node}
          hasChildren={withChildren.has(normPath(menu.node.path))}
          expanded={expanded.has(normPath(menu.node.path))}
          onSelect={onMenuSelect}
          onClose={() => {
            setMenu(null);
          }}
        />
      ) : null}
    </aside>
  );
});
