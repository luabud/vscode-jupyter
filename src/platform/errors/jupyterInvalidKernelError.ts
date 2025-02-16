// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { DataScience } from '../../platform/common/utils/localize';
import { sendTelemetryEvent } from '../../telemetry';
import { Telemetry } from '../../datascience-ui/common/constants';
import { getDisplayNameOrNameOfKernelConnection } from '../../kernels/helpers';
import { KernelConnectionMetadata } from '../../kernels/types';
import { BaseKernelError } from './types';

export class JupyterInvalidKernelError extends BaseKernelError {
    constructor(kernelConnectionMetadata: KernelConnectionMetadata) {
        super(
            'invalidkernel',
            DataScience.kernelInvalid().format(getDisplayNameOrNameOfKernelConnection(kernelConnectionMetadata)),
            kernelConnectionMetadata
        );
        sendTelemetryEvent(Telemetry.KernelInvalid);
    }
}
