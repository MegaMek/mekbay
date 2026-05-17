import type {
	BuiltInTransportBucketValue,
} from '../org-types';

export const TRANSPORT_BA_ALL_BUCKETS = ['BA', 'BA:mec', 'BA:xmec', 'BA:mec+xmec'] as const satisfies readonly BuiltInTransportBucketValue[];
export const TRANSPORT_BA_QUALIFIED_BUCKETS = ['BA:mec', 'BA:xmec', 'BA:mec+xmec'] as const satisfies readonly BuiltInTransportBucketValue[];
export const TRANSPORT_BA_MEC_BUCKETS = ['BA:mec', 'BA:mec+xmec'] as const satisfies readonly BuiltInTransportBucketValue[];
export const TRANSPORT_BA_XMEC_BUCKETS = ['BA:xmec', 'BA:mec+xmec'] as const satisfies readonly BuiltInTransportBucketValue[];
export const TRANSPORT_BM_CARRIER_BUCKETS = ['BM', 'BM:omni'] as const satisfies readonly BuiltInTransportBucketValue[];
export const TRANSPORT_BM_OMNI_CARRIER_BUCKETS = ['BM:omni'] as const satisfies readonly BuiltInTransportBucketValue[];
export const TRANSPORT_CV_CARRIER_BUCKETS = ['CV', 'CV:omni'] as const satisfies readonly BuiltInTransportBucketValue[];
export const TRANSPORT_CV_OMNI_CARRIER_BUCKETS = ['CV:omni'] as const satisfies readonly BuiltInTransportBucketValue[];
export const TRANSPORT_AF_CARRIER_BUCKETS = ['AF', 'AF:omni'] as const satisfies readonly BuiltInTransportBucketValue[];
export const TRANSPORT_AF_OMNI_CARRIER_BUCKETS = ['AF:omni'] as const satisfies readonly BuiltInTransportBucketValue[];
export const TRANSPORT_NON_BM_NOVA_BUCKETS = ['CV', 'CV:omni', 'AF', 'AF:omni', 'BA'] as const satisfies readonly BuiltInTransportBucketValue[];
export const TRANSPORT_NON_CV_NOVA_BUCKETS = ['BM', 'BM:omni', 'AF', 'AF:omni', 'BA'] as const satisfies readonly BuiltInTransportBucketValue[];
export const TRANSPORT_NON_AF_NOVA_BUCKETS = ['BM', 'BM:omni', 'CV', 'CV:omni', 'BA'] as const satisfies readonly BuiltInTransportBucketValue[];
export const INFANTRY_CI_TROOPER_BUCKETS = { prefix: 'CI:' } as const;