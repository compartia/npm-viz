/// <reference path="externs.d.ts"/>


/* Copyright 2015 The TensorFlow Authors. All Rights Reserved.

Licensed under the Apache License, Version 2.0 (the 'License');
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an 'AS IS' BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
==============================================================================*/
 
 
import * as graphlib from 'graphlib';
 
import * as _ from 'lodash';
import * as proto from './proto';
 
import { runAsyncTask } from "./util";
import { Hierarchy } from './hierarchy';
import { ProgressTracker } from './common';

// const graphlib = require('graphlib');


/** Delimiter used in node names to denote namespaces. */
export const NAMESPACE_DELIM = '/';
export const ROOT_NAME = '__root__';
export const FUNCTION_LIBRARY_NODE_PREFIX = '__function_library__';

/** Attribute key used for storing attributes that are too large. */
export const LARGE_ATTRS_KEY = '_too_large_attrs';
/**
 * Maximum allowed size in bytes, before the attribute is considered large
 * and filtered out of the graph.
 */
export const LIMIT_ATTR_SIZE = 1024;

// Separator between the source and the destination name of the edge.
export const EDGE_KEY_DELIM = '--';

export enum GraphType {FULL, EMBEDDED, META, SERIES, CORE, SHADOW, BRIDGE,
    EDGE};
export enum NodeType {META, OP, SERIES, BRIDGE, ELLIPSIS};

/** Indicates if a node is to be included in the main graph when rendered. */
export enum InclusionType {INCLUDE, EXCLUDE, UNSPECIFIED};

/** Indicates if a series is to be grouped in the graph when rendered. */
export enum SeriesGroupingType {GROUP, UNGROUP};


/**
 * A BaseEdge is the label object (in the graphlib sense) for an edge in the
 * original, full graph produced after parsing. Subsequent graphs, like those
 * which belong to Metanodes, should not use BaseEdge objects, but instead
 * contain Metaedges (which in turn may contain any number of BaseEdges).
 */
export interface BaseEdge extends AbstractBaseEdge {
  isControlDependency: boolean;
  isReferenceEdge: boolean;
  /** The index of the output tensor of the source node. */
  outputTensorKey: string;
}

/**
 * A SlimGraph is inspired by graphlib.Graph, but having only the functionality
 * that we need.
 */
export class SlimGraph {
  nodes: { [nodeName: string]: OpNode };
  edges: BaseEdge[];

  constructor() {
    this.nodes = {};
    this.edges = [];
  }
}

export interface NormalizedInput {
  name: string;
  /** The index of the output tensor of the source node. */
  outputTensorKey: string;
  isControlDependency: boolean;
}

export interface BuildParams {
  enableEmbedding: boolean;
  inEmbeddingTypes: string[];
  outEmbeddingTypes: string[];
  refEdges: { [inputEdge: string]: boolean };
}

/**
 * The most basic information about a node in the hierarchical graph.
 */
export interface Node {
  /** The name of the node, used frequently to look up nodes by name. */
  name: string;
  /** Which type of node this is. */
  type: NodeType;
  /**
   * Whether this node is a type that may contain other nodes. Those types
   * should extend from GroupNode.
   *
   * For an OpNode, isGroupNode will be false, even though it may have
   * embeddings. These embedding Nodes will have their parentNode set to the
   * OpNode. However, embeddings are later rendered as annotations, not as
   * children to be made visible on expansion (like a Metanode or SeriesNode).
   */
  isGroupNode: boolean;
  /**
   * The number of nodes this node represents. For OpNodes, this will be 1, and
   * for GroupNodes it will be a count of the total number of descendents it
   * contains.
   */
  cardinality: number;
  /**
   * The Node which is this Node's parent. This is of type Node and not
   * GroupNode because of embeddings, which will have a parent OpNode.
   */
  parentNode: Node;
  
  /** If the node is to be included or excluded from the main graph when
   *  rendered. Defaults to UNSPECIFIED, which means that the rendering
   *  algorithm determines if it will be included or not. Then can be set to
   *  INCLUDE or EXCLUDE manually by the user.
   */
  include: InclusionType;
  /**
   * Node attributes specify customizable visual aspects of a node and
   * application-specific metadata associated with a node. The name
   * 'nodeAttributes' is meant to avoid naming-conflicts with the 'attr' in
   * subclasses of Node.
   */
  nodeAttributes: {[key: string]: any;};
} 

export interface OpNode extends Node {
  op: string;
  // The device on which the op ran. Null if it is unknown.
  device: string;
  // attr: {key: string, value: any}[];
  inputs: NormalizedInput[];
  outputs: NormalizedInput[];
  
  inEmbeddings: OpNode[];
  outEmbeddings: OpNode[];
  // The name of the SeriesNode that can contain this node in its series.
  // If there is no such node, then this is null.
  owningSeries: string;
  

  // The XLA Cluster on which the op ran. Null if it is unknown.
  xlaCluster: string;

  // Whether op is compatible with its assigned device.  Currently, if an op
  // is not specified a device, the device is defaulted to the TPU.
  // Furthermore, all ops are considered compatible for CPU and GPU devices,
  // while a whitelist of compatible ops are specifed for the TPU.
  // Reference: opValid func in op.ts.
  compatible: boolean;

  // This field is only defined if the op node represents an input_arg to a
  // library function. It is the index of the input_arg.
  functionInputIndex: number;

  // This field is only defined if the op node represents an output_arg of a
  // library function. It is the index of the output_arg.
  functionOutputIndex: number;
}

export interface BridgeNode extends Node {
  /**
   * Whether this bridge node represents edges coming into its parent node.
   */
  inbound: boolean;
}

/**
 * A node that is used when there are more than the maximum number of allowed
 * annotations hanging off of a node.  This node represents an ellipsis
 * annotation, indicating a number of additional annotations.
 */
export interface EllipsisNode extends Node {
  /**
   * The number of nodes this ellipsis represents.
   */
  numMoreNodes: number;

  /**
   * Sets the number of nodes this ellipsis represents and changes the node
   * name accordingly.
   */
  setNumMoreNodes(numNodes: number);
}

export interface GroupNode extends Node {
  /**
   * The metagraph contains nodes and metaedges between the immediate children
   * of this group. The node label objects may be other GroupNodes (like
   * SeriesNodes and Metanodes) or individual OpNodes. All edge label objects
   * are Metaedges, each of which contains references to the original
   * BaseEdge(s) from which it was created.
   */
  metagraph: graphlib.Graph<GroupNode|OpNode, Metaedge>;

  /**
   * The bridgegraph contains only edges which link immediate children of this
   * group with nodes outside of the metagraph. As in the metagraph, all edge
   * label objects are Metaedges which contain references to the original
   * BaseEdge(s) that contribute to it.
   *
   * For a Metaedge in the bridgegraph, its external endpoint will be the same
   * as the metagraph edge from which it came. This is most easily explained
   * by example.
   *
   * Consider an original graph that contains a BaseEdge A/B/C->Z/Y/X.
   *
   *     +-------+    (BaseEdge)     +-------+
   *     | A/B/C |>----------------->| Z/Y/X |
   *     +-------+                   +-------+
   *
   * When we construct the Root's metagraph, it will contain nodes for A and Z,
   * and a Metaedge A->Z. The A->Z Metaedge will contain the original BaseEdge
   * A/B/C->Z/Y/X in its baseEdgeGraph. The Root's bridgegraph will always be
   * empty.
   *
   *     +---+    (Root.metagraph edge)    +---+
   *     | A |>--------------------------->| Z |
   *     +---+                             +---+
   *
   * Now consider the Metanode A. Its metagraph will contain a Metanode for A/B
   * and no edges. A's bridgegraph will have one Metaedge from A/B->Z, which
   * was derived from the Root's Metaedge A->Z. That Metaedge will contain the
   * original BaseEdge in its baseEdgeGraph.
   *
   *     +---------+
   *     | A       |
   *     |  +---+  |   (A.bridgegraph edge)    +---+
   *     |  | B |>---------------------------->| Z |
   *     |  +---+  |                           +---+
   *     +---------+
   *
   * Finally, consider the Metanode A/B. Its metagraph will contain a Metanode
   * for A/B/C and again no edges. A/B's bridgegraph will have one Metaedge
   * from A/B/C->Z, which was derived from A's bridgegraph Metaedge A/B->Z.
   * As before, the A/B/C->Z Metaedge will contain the original BaseEdge in its
   * baseEdgeGraph.
   *
   *     +---------------+
   *     | A             |
   *     |  +---------+  |
   *     |  | B       |  |
   *     |  |  +---+  |  |   (A/B.bridgegraph edge)      +---+
   *     |  |  | C |>----------------------------------->| Z |
   *     |  |  +---+  |  |                               +---+
   *     |  +---------+  |
   *     +---------------+
   *
   * Likewise, under the Metanode Z and Z/Y, to compute the bridgegraph, we'll
   * end up with Metaedges A->Z/Y and A->Z/Y/X respectively. So the original
   * BaseEdge A/B/C->Z/Y/X becomes four different Metaedges in four different
   * bridgegraphs:
   *
   *   + A/B->Z in GroupNode A's bridgegraph,
   *   + A/B/C->Z in GroupNode A/B's bridgegraph,
   *   + A->Z/Y in GroupNode Z's bridgegraph, and
   *   + A->Z/Y/X in GroupNode Z/Y's bridgegraph.
   *
   * Considering any BaseEdge then, if N is the number of path segments in the
   * source and M is the number of path segments in the destination, then the
   * total number of bridgegraph edges you could create would be (N-1)(M-1).
   *
   * For this reason, it is computationally expensive to generate all the
   * bridgegraphs for all the Metanodes, and instead they should be computed
   * on demand as needed.
   */
  bridgegraph: graphlib.Graph<GroupNode|OpNode, Metaedge>;

  /**
   * Stores how many times each device name appears in its children
   * op nodes. Used to color group nodes by devices.
   */
  deviceHistogram: {[device: string]: number};

  /**
   * Stores how many ops in sub-graph were compatible and how many are
   * incompatible.
   */
  compatibilityHistogram: {compatible: number, incompatible: number}

  /**
   * Flag indicating whether this GroupNode's metagraph contains any edges that
   * are not control edges. Used to quickly determine how to draw a collapsed
   * series (vertically or horizontally).
   */
  hasNonControlEdges: boolean;
}

export interface Metanode extends GroupNode {
  depth: number;
  templateId: string;
  opHistogram: {[op: string]: number};

  // The name of the function this metanode is associated with if any.
  associatedFunction: string;
  
  getFirstChild(): GroupNode|OpNode;
  getRootOp(): OpNode;
  /** Return name of all leaves inside a metanode. */
  leaves(): string[];
}

export interface SeriesNode extends GroupNode {
  hasLoop: boolean;
  prefix: string;
  suffix: string;
  clusterId: number;
  ids: number[];
  parent: string;
}

export class EllipsisNodeImpl implements EllipsisNode {
  name: string;
  numMoreNodes: number;
  type: NodeType;
  isGroupNode: boolean;
  cardinality: number;
  parentNode: Node;
  include: InclusionType;
  nodeAttributes: {[key: string]: any;};
  /**
   * Constructs a new ellipsis annotation node.
   *
   * @param numNodes The number of additional annotations this node represents.
   */
  constructor(numNodes: number) {
    this.type = NodeType.ELLIPSIS;
    this.isGroupNode = false;
    this.cardinality = 1;
    this.parentNode = null;
    this.setNumMoreNodes(numNodes);
    this.include = InclusionType.UNSPECIFIED;
  }

  setNumMoreNodes(numNodes: number) {
    this.numMoreNodes = numNodes;
    this.name = '... ' + numNodes + ' more';
  }
};

/**
 * A label object for nodes in the full graph and leaf nodes in the render
 * graph.
 */
export class OpNodeImpl implements OpNode {
  name: string;
  op: string;
  device: string;

   
  inputs: NormalizedInput[];
  outputs: NormalizedInput[];

  type: NodeType;
  isGroupNode: boolean;
  cardinality: number;
  inEmbeddings: OpNode[];
  outEmbeddings: OpNode[];
  parentNode: Node;
  include: InclusionType;
  owningSeries: string;  
  nodeAttributes: {[key: string]: any;};
  xlaCluster: string;
  compatible: boolean;

  // This field is only defined if the op node represents an input_arg to a
  // library function. It is the index of the input_arg.
  functionInputIndex: number;
  
  // This field is only defined if the op node represents an output_arg of a
  // library function. It is the index of the output_arg.
  functionOutputIndex: number;
 
  /**
   * Constructs a new Op node.
   *
   * @param rawNode The raw node.
   */
  constructor(rawNode: proto.NodeDef) {
    this.op = rawNode.op;
    this.name = rawNode.name;
    this.device = rawNode.device;
    this.nodeAttributes = rawNode.nodeAttributes;
    // An array of normalized inputs that denote the incoming edges to
    // the current node. Each input contains the normalized name of the
    // source node, whether it has a number part and whether it is a
    // control dependency.
    this.inputs = normalizeInputs(rawNode.input);
    this.outputs = normalizeInputs(rawNode.output);

    this.xlaCluster = extractXlaCluster(rawNode.nodeAttributes);
    this.compatible = false;
    // additional properties
    this.type = NodeType.OP;
    this.isGroupNode = false;
    this.cardinality = (rawNode as any).degree;
    this.inEmbeddings = [];
    this.outEmbeddings = [];
    this.parentNode = null;
    this.include = InclusionType.UNSPECIFIED;
    this.owningSeries = null;
  }
};

export function createMetanode(name: string, opt = {}): Metanode {
  return new MetanodeImpl(name, opt);
}

 

export class MetanodeImpl implements Metanode {
  name: string;
  type: NodeType;
  depth: number;
  isGroupNode: boolean;
  cardinality: number;
  metagraph: graphlib.Graph<GroupNode|OpNode, Metaedge>;
  bridgegraph: graphlib.Graph<GroupNode|OpNode, Metaedge>;
  templateId: string;
  opHistogram: {[op: string]: number};
  deviceHistogram: {[op: string]: number};
  compatibilityHistogram: {compatible: number, incompatible: number};
  parentNode: Node;
  hasNonControlEdges: boolean;
  include: InclusionType;
  nodeAttributes: {[key: string]: any;};
  associatedFunction: string;

  /** A label object for meta-nodes in the graph hierarchy */
  constructor(name: string, opt = {}) {
    this.name = name;
    this.type = NodeType.META;
    /** number of levels under this group */
    this.depth = 1;
    this.isGroupNode = true;
    /** # of leaf nodes (including embedded ones) */
    this.cardinality = 0;
    /** graph contains metanodes, nodes, edges
     * and metaedges for main items within this metanode
     */
    this.metagraph =
      createGraph<GroupNode|OpNode, Metaedge>(name, GraphType.META, opt);
    /** bridgegraph must be constructed lazily-see hierarchy.getBridgegraph() */
    this.bridgegraph = null;
    /**
     * A dictionary that count ops type of nodes in this metanode
     * (op type => count).
     */
    this.opHistogram = {};
    this.deviceHistogram = {};
    this.compatibilityHistogram = {compatible: 0, incompatible: 0};
    /** unique id for a metanode of similar subgraph */
    this.templateId = null;
    /** Metanode which contains this node, if any */
    this.parentNode = null;
    this.hasNonControlEdges = false;
    this.include = InclusionType.UNSPECIFIED;
    this.associatedFunction = '';
  }

  getFirstChild(): GroupNode|OpNode {
    return this.metagraph.node(this.metagraph.nodes()[0]);
  }

  /**
   * Returns the op node associated with the metanode.
   * For example, if the metanode is 'sgd', the associated
   * op node is sgd/(sgd).
   */
  getRootOp(): OpNode {
    let nameSplit = this.name.split('/');
    let rootOpName = this.name + '/(' + nameSplit[nameSplit.length - 1] + ')';
    return <OpNode>this.metagraph.node(rootOpName);
  }

  /**
   * Return an array of the names of all the leaves (non-GroupNodes) inside
   * this metanode. This performs a breadth-first search of the tree, so
   * immediate child leaves will appear earlier in the output array than
   * descendant leaves.
   */
  leaves(): string[] {
    let leaves = [];
    let queue = [<Node> this];
    let metagraph; // Defined here due to a limitation of ES6->5 compilation.
    while (queue.length) {
      let node = queue.shift();
      if (node.isGroupNode) {
        metagraph = (<GroupNode> node).metagraph;
        _.each(metagraph.nodes(), name => queue.push(metagraph.node(name)));
      } else {
        leaves.push(node.name);
      }
    }
    return leaves;
  }
};

export interface AbstractBaseEdge extends graphlib.EdgeObject{
  v: string;
  w: string;
  name?: string;
}
export interface Metaedge extends AbstractBaseEdge {
  v: string;
  w: string;
  name?: string;
  /**
   * Stores the original BaseEdges represented by this Metaedge.
   */
  baseEdgeList: BaseEdge[];

  /**
   * Whether this edge represents a relationship that is inbound (or outbound)
   * to the object which contains this information. For example, in a Metanode's
   * bridgegraph, each edge connects an immediate child to something outside
   * the Metanode. If the destination of the edge is inside the Metanode, then
   * its inbound property should be true. If the destination is outside the
   * Metanode, then its inbound property should be false.
   *
   * The property is optional because not all edges can be described as
   * inbound/outbound. For example, in a Metanode's metagraph, all of the edges
   * connect immediate children of the Metanode. None should have an inbound
   * property, or they should be null/undefined.
   */
  inbound: boolean;

  /**
   * Number of regular edges (not control dependency edges).
   */
  numRegularEdges: number;

  /**
   * Number of control dependency edges.
   */
  numControlEdges: number;

  /**
   * Number of reference edges, which is an edge to an operation
   * that takes a reference to its input and changes its value.
   */
  numRefEdges: number;

  /**
   * Total size (number of units) of all the tensors flowing through this edge.
   */
  totalSize: number;

  addBaseEdge(edge: BaseEdge, h: Hierarchy): void;
}

export function createMetaedge(v: string, w: string): Metaedge {
  return new MetaedgeImpl(v, w);
}

/**
 * A label object for edges between metanodes of subgraphs in the render graph.
 */
export class MetaedgeImpl implements Metaedge {
  v: string;
  w: string;
  baseEdgeList: BaseEdge[];
  inbound: boolean;
  numRegularEdges: number;
  numControlEdges: number;
  numRefEdges: number;
  totalSize: number;

  constructor(v: string, w: string) {
    this.v = v;
    this.w = w;
    this.baseEdgeList = [];
    this.inbound = null;
    this.numRegularEdges = 0;
    this.numControlEdges = 0;
    this.numRefEdges = 0;
    this.totalSize = 0;
  }

  addBaseEdge(edge: BaseEdge, h: Hierarchy): void {
    this.baseEdgeList.push(edge);
    if (edge.isControlDependency) {
      this.numControlEdges += 1;
    } else {
      this.numRegularEdges += 1;
    }
    if (edge.isReferenceEdge) {
      this.numRefEdges += 1;
    }
    // Compute the size of the tensor flowing through this
    // base edge.
    this.totalSize += 1;
    h.maxMetaEdgeSize = Math.max(h.maxMetaEdgeSize, this.totalSize);
  }

   
}

export function createSeriesNode(
    prefix: string,
    suffix: string,
    parent: string,
    clusterId: number,
    name: string,
    graphOptions: graphlib.GraphOptions): SeriesNode {
  return new SeriesNodeImpl(
      prefix, suffix, parent, clusterId, name, graphOptions);
}

export function getSeriesNodeName(prefix: string, suffix: string,
    parent: string, startId?: number, endId?: number): string {
  let numRepresentation =
      (typeof startId !== 'undefined' && typeof endId !== 'undefined') ?
      '[' + startId + '-' + endId + ']' :
      '#';
  let pattern = prefix + numRepresentation + suffix;
  return (parent ? parent + '/' : '') + pattern;
}

class SeriesNodeImpl implements SeriesNode {
  name: string;
  type: NodeType;
  hasLoop: boolean;
  prefix: string;
  suffix: string;
  clusterId: number;
  ids: number[];
  parent: string;
  isGroupNode: boolean;
  cardinality: number;
  metagraph: graphlib.Graph<GroupNode|OpNode, Metaedge>;
  bridgegraph: graphlib.Graph<GroupNode|OpNode, Metaedge> | null;
  parentNode: Node;
  deviceHistogram: {[op: string]: number};
  compatibilityHistogram: {compatible: number, incompatible: number};
  hasNonControlEdges: boolean;
  include: InclusionType;
  nodeAttributes: proto.NodeAttributes;

  constructor(
      prefix: string,
      suffix: string,
      parent: string,
      clusterId: number,
      name: string,
      graphOptions: graphlib.GraphOptions) {
    this.name = name || getSeriesNodeName(prefix, suffix, parent);
    this.type = NodeType.SERIES;
    this.hasLoop = false;
    this.prefix = prefix;
    this.suffix = suffix;
    this.clusterId = clusterId;
    this.ids = [];
    this.parent = parent;
    this.isGroupNode = true;
    this.cardinality = 0;
    this.metagraph = createGraph<Metanode, Metaedge>(
        name, GraphType.SERIES, graphOptions);
    // bridgegraph must be constructed lazily-see hierarchy.getBridgegraph()
    this.bridgegraph = null;
    this.parentNode = null;
    this.deviceHistogram = {};
    this.compatibilityHistogram = {compatible: 0, incompatible: 0};
    this.hasNonControlEdges = false;
    this.include = InclusionType.UNSPECIFIED;
  }
}
 

/**
 * Extracts the XLA Cluster that an op runs on from the attrs of the OpNode.
 * @param attr The attr property.
 * @return A string that is the name of the cluster. Or null if it could not be
 *     determined.
 */
// tslint:disable-next-line:no-any
function extractXlaCluster(attr: {[key: string]: any;}): string | null {
  if (!attr) {
    return null;
  }

  // // Find the attribute for XLA cluster if there is one.
  // for (let i = 0; i < attr.length; i++) {
  //   if (attr[i].key === _XLA_CLUSTER_KEY) {
  //     return attr[i].value['s'] || null;
  //   }
  // }
  return null;
}

/**
 * Normalizes the inputs and extracts associated metadata:
 * 1) Inputs can contain a colon followed by a suffix of characters.
 *    That suffix may be a single number (e.g. inputName:1) or several word
 *    characters separated from a number by a colon (e.g. inputName:foo:1). The
 *    latter case is used to denote inputs and outputs of functions.
 * 2) Control dependency inputs contain caret at the beginning and we
 *    remove this and annotate the edge as a control dependency.
 * @param inputs Array of unnormalized names of input nodes.
 */
function normalizeInputs(inputs: string[]): NormalizedInput[] {
  let normalizedInputs: NormalizedInput[] = [];
  _.each(inputs, inputName => {
    let isControlDependency = inputName[0] === '^';
    if (isControlDependency) {
      // The carat merely indicates whether this input is a control dependency.
      // It should not be part of the name.
      inputName = inputName.substring(1);
    }

    let name = inputName;
    let outputTensorKey = '0';

    let match = inputName.match(/(.*):(\w+:\d+)$/);
    if (match) {
      // The output string consists of several characters and a number separated
      // by a colon.
      name = match[1];
      outputTensorKey = match[2];
    } else {
      match = inputName.match(/(.*):(\d+)$/);
      if (match) {
        // The output string consists of a single number.
        name = match[1];
        outputTensorKey = match[2];
      }
    }

    if (normalizedInputs.length === 0 ||
      name !== normalizedInputs[normalizedInputs.length - 1].name) {
      normalizedInputs.push({
        name: name,
        outputTensorKey: outputTensorKey,
        isControlDependency: isControlDependency,
      });
    }
  });
  return normalizedInputs;
}

function addEdgeToGraph(
    graph: SlimGraph, inputName: string, outputNode: OpNode,
    input: NormalizedInput, params: BuildParams, index: number) {
  // Don't allow loops in the graph.
  if (inputName === outputNode.name) {
    return;
  }
  // Check if this op type and input number corresponds to a
  // reference edge using the refEdges dictionary in the params.
  let isRefEdge = params.refEdges[outputNode.op + ' ' + index] === true;
  graph.edges.push({
    v: inputName,
    w: outputNode.name,
    outputTensorKey: input.outputTensorKey,
    isControlDependency: input.isControlDependency,
    isReferenceEdge: isRefEdge
  });
}

export function build(
    graphDef:  proto.GraphDef, params: BuildParams,
    tracker: ProgressTracker): Promise<SlimGraph|void> {
  /**
   * A dictionary that maps each in-embedding node name to the node
   * object.
   */
  let inEmbedding: {[nodeName: string]: OpNode} = {};
  /**
   * A dictionary that maps each out-embedding node name to the node
   * object.
   */
  let outEmbedding: {[nodeName: string]: OpNode} = {};
  /**
   * A dictionary that maps each node name to an array of the node's
   * out-embedding node label objects.
   */
  let outEmbeddings: {[inputName: string]: OpNode[]} = {};
  
  let embeddingNodeNames: string[] = [];
  let rawNodes = graphDef.node;
  /**
   * A list of all the non-embedding node names which appear in the processed
   * list of raw nodes. Here we pre-allocate enough room for all the rawNodes,
   * even though there will some number of embeddings. The excess array length
   * is spliced off later.
   *
   * Experimentation shows that around 30% of the array will go unused, and
   * even for very large networks that amounts to less than 10k spaces.
   */
  let nodeNames = new Array<string>(rawNodes.length);

  return runAsyncTask(
          'Normalizing names', 30,
          () => {
            let opNodes = new Array<OpNode>(rawNodes.length);
            let index = 0;

            const processRawNode = (rawNode: proto.NodeDef) => {
              let opNode = new OpNodeImpl(rawNode);

              if ((rawNode as any).degree > 5) {
                opNode.include=InclusionType.EXCLUDE;
              }
              opNodes[index] = opNode;
              nodeNames[index] = opNode.name;
              
              index++;
              return opNode;
                   
            };
            
            rawNodes.forEach(processRawNode);              
            opNodes.splice(index);
            nodeNames.splice(index);
            return opNodes;
          },
          tracker)

      .then((opNodes) => {
        // Create the graph data structure from the graphlib library.
        return  runAsyncTask(
            'Building the data structure', 70, () => {
              let normalizedNameDict = mapStrictHierarchy(nodeNames, embeddingNodeNames);
              let graph = new SlimGraph();

              // Add the nodes to the graph.
              _.each(opNodes, opNode => {
                let normalizedName =
                  normalizedNameDict[opNode.name] || opNode.name;
                graph.nodes[normalizedName] = opNode;

                // Update the name of the node.
                opNode.name = normalizedName;
              });

              // Visit each node's inputs to add the edges to the graph. If the
              // input
              
              opNodes.forEach(
                opNode => {                  
                  _.each(opNode.inputs, (input, i) => {
                    let inputName = input.name;
  
                    addEdgeToGraph(
                      graph, normalizedNameDict[inputName] || inputName,
                      opNode, input, params, i);
  
                  });
                }
              );
              


              return graph;
            }, tracker);
      });
};

/**
 * Create a new graphlib.Graph() instance with default parameters
 */
export function createGraph<N, E>(
    name: string, type,
    opt?: graphlib.GraphOptions): graphlib.Graph<N, E> {
  const graphOptions = opt || {};
  let graph = new graphlib.Graph<N, E>(graphOptions);
  graph.setGraph({
    name: name,
    rankdir: graphOptions.rankdir || 'LR',  // BT,TB,LR,RL
    type: type
  });
  return graph;
};

 
/**
 * Returns a strict node name (name => name/(name)) to avoid conflicts
 * where the node name is also a namespace.
 */
export function getStrictName(name: string): string {
  let parts = name.split(NAMESPACE_DELIM);
  return name + NAMESPACE_DELIM + '(' + parts[parts.length - 1] + ')';
}

/**
 * For each op node (embedding or non-embedding), rename it if there is a
 * non-embedding node under its namespace. For example, assume node name 'A'.
 * If there is a non-embedding node under its namespace (e.g. 'A/B'), 'A' will
 * be renamed to 'A/(A)'. Then the namespace 'A' will contain 2 nodes: '(A)'
 * and 'B'. If all the nodes under 'A' are embedding nodes (e.g. constant and
 * summary), keep 'A' as an Op node and don't create a namespace.
 *
 * @param nodeNames An array of regular (non-embedding) node names.
 * @param embeddingNodeNames An array of embedding node names.
 * @return Dictionary object mapping names that need to be renamed to
 *     new names.
 */
function mapStrictHierarchy(nodeNames: string[],
    embeddingNodeNames: string[]): {[oldName: string]: string} {
  /** Dictionary that maps the old new to the new name */
  let newNameDictionary: {[oldName: string]: string} = {};
  /** Set used to store all namespaces. */
  let namespaceSet: {[namespace: string]: boolean} = {};
  // sort the nodes to make prefix check faster
  nodeNames.sort();
  // look for nodes with a prefix a,a/b -> a/(a),a/b
  for (let i = 0; i < nodeNames.length - 1; ++i) {
    let a = nodeNames[i];
    // Get all the parent namespaces of the current node
    // and add them in the namespace set.
    _.each(getHierarchicalPath(a).slice(0, -1), ns => {
      namespaceSet[ns] = true;
    });
    for (let j = i + 1; j < nodeNames.length; ++j) {
      let b = nodeNames[j];
      if (_.startsWith(b, a)) {
        if (b.length > a.length && b.charAt(a.length) === NAMESPACE_DELIM) {
          newNameDictionary[a] = getStrictName(a);
          break;
        }
      } else {
        break;
      }
    }
  }
  // Go through all the embedding node names and rename them in case they
  // collide with namespaces.
  _.each(embeddingNodeNames, embeddingName => {
    if (embeddingName in namespaceSet) {
      // Rename to follow strict hierarchy.
      newNameDictionary[embeddingName] = getStrictName(embeddingName);
    }
  });
  return newNameDictionary;
};

/**
 * Returns a list of the degrees of each node in the graph.
 */
function degreeSequence(graph: graphlib.Graph<any, any>): number[] {
  let degrees = graph.nodes().map(function(name) {
    return graph.neighbors(name).length;
  });
  degrees.sort();
  return degrees;
};

/**
 * Returns if the degree sequence of the two graphs is the same.
 */
export function hasSimilarDegreeSequence(graph1: graphlib.Graph<any, any>,
    graph2: graphlib.Graph<any, any>): boolean {
  let dg1 = degreeSequence(graph1);
  let dg2 = degreeSequence(graph2);

  for (let i = 0; i < dg1.length; i++) {
    if (dg1[i] !== dg2[i]) {
      return false;
    }
  }
  return true;
};

/**
 * Returns the hierarchical path of the current node, based on the node's name.
 * For example, if the name is 'a/b/c', the returned path is
 * ['a', 'a/b', 'a/b/c'].
 */
export function getHierarchicalPath(name: string,
  seriesNames?: { [name: string]: string }): string[] {
  let path: string[] = [];
  let i = name.indexOf(NAMESPACE_DELIM);
  // Push all parent portions of the path.
  while (i >= 0) {
    path.push(name.substring(0, i));
    i = name.indexOf(NAMESPACE_DELIM, i + 1);
  }
  // If the node's path is under a series, then add the series node name to the
  // hierarchical path as the parent of the leaf.
  if (seriesNames) {
    let seriesName = seriesNames[name];
    if (seriesName) {
      path.push(seriesName);
    }
  }
  // Push the leaf of the path.
  path.push(name);
  return path;
};

/**
 * Returns the string for the node inclusion toggle button, dependant
 * on the provided current InclusionType.
 */
export function getIncludeNodeButtonString(include: InclusionType) {
  if (include === InclusionType.EXCLUDE) {
    return 'Add to main graph';
  } else {
    return 'Remove from main graph';
  }
};

/**
 * Returns the string for the series node grouping toggle button, dependant
 * on the provided current SeriesGroupingType.
 */
export function getGroupSeriesNodeButtonString(group: SeriesGroupingType) {
  if (group === SeriesGroupingType.GROUP) {
    return 'Ungroup this series of nodes';
  } else {
    return 'Group this series of nodes';
  }
};

/**
 * Toggle the node series grouping option in the provided map, setting it
 * to ungroup if the series is not already in the map.
 */
export function toggleNodeSeriesGroup(
  map: { [name: string]:  SeriesGroupingType }, name: string) {
  if (!(name in map) || map[name] === SeriesGroupingType.GROUP) {
    map[name] =  SeriesGroupingType.UNGROUP;
  } else {
    map[name] =  SeriesGroupingType.GROUP;
  }
};

 
